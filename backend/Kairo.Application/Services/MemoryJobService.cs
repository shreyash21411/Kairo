using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.Extensions.Logging;

namespace Kairo.Application.Services;

/// <summary>
/// Phase 4A: Application service coordinating durable asynchronous memory ingestion jobs.
/// </summary>
public class MemoryJobService : IMemoryJobService
{
    private readonly IIngestionJobRepository _jobRepository;
    private readonly IMemoryRepository _memoryRepository;
    private readonly IScopeResolutionService _scopeResolutionService;
    private readonly IEmbeddingGenerator _embeddingGenerator;
    private readonly ITransactionCoordinator _transactionCoordinator;
    private readonly IEntityExtractionService? _entityExtractionService;
    private readonly IEntityRepository? _entityRepository;
    private readonly IMemoryIngestionService? _ingestionService;
    private readonly ILogger<MemoryJobService> _logger;

    private static readonly HashSet<string> ValidMemoryTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "Preference", "Fact", "Goal", "Context", "Skill", "Relationship", "Other"
    };

    private const string EmbeddingModel = "mistral-embed";

    public MemoryJobService(
        IIngestionJobRepository jobRepository,
        IMemoryRepository memoryRepository,
        IScopeResolutionService scopeResolutionService,
        IEmbeddingGenerator embeddingGenerator,
        ITransactionCoordinator transactionCoordinator,
        ILogger<MemoryJobService> logger,
        IEntityExtractionService? entityExtractionService = null,
        IEntityRepository? entityRepository = null,
        IMemoryIngestionService? ingestionService = null)
    {
        _jobRepository = jobRepository;
        _memoryRepository = memoryRepository;
        _scopeResolutionService = scopeResolutionService;
        _embeddingGenerator = embeddingGenerator;
        _transactionCoordinator = transactionCoordinator;
        _logger = logger;
        _entityExtractionService = entityExtractionService;
        _entityRepository = entityRepository;
        _ingestionService = ingestionService;
    }

    /// <inheritdoc />
    public async Task<AsyncJobAcceptedResponse> EnqueueAsyncCreateMemoryAsync(
        CreateMemoryRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Content))
        {
            throw new ArgumentException("Content cannot be empty.", nameof(request.Content));
        }

        if (request.Content.Length > 10_000)
        {
            throw new ArgumentException("Content must not exceed 10,000 characters.", nameof(request.Content));
        }

        if (string.IsNullOrWhiteSpace(request.MemoryType))
        {
            throw new ArgumentException("MemoryType cannot be empty.", nameof(request.MemoryType));
        }

        if (!ValidMemoryTypes.Contains(request.MemoryType))
        {
            throw new ArgumentException(
                $"MemoryType '{request.MemoryType}' is not valid. Accepted values: {string.Join(", ", ValidMemoryTypes)}.",
                nameof(request.MemoryType));
        }

        var metadataJson = request.Metadata != null && request.Metadata.Count > 0
            ? JsonSerializer.Serialize(request.Metadata)
            : null;

        if (metadataJson != null && metadataJson.Length > 8_192)
        {
            throw new ArgumentException("Metadata must not exceed 8,192 characters when serialized as JSON.", nameof(request.Metadata));
        }

        var normalizedCategories = CategoryValidator.ValidateAndNormalize(request.Categories);
        var expiresAt = ExpirationHelper.ResolveExpiresAt(request.ExpiresAt, request.Ttl);

        // Resolve scope
        long? scopeId = null;
        if (request.Scope != null && !request.Scope.IsEmpty)
        {
            scopeId = await _scopeResolutionService.GetOrCreateFromScopeKeyAsync(projectId, request.Scope, cancellationToken);
        }
        else if (!string.IsNullOrWhiteSpace(request.ActorId))
        {
            scopeId = await _scopeResolutionService.GetOrCreateScopeAsync(projectId, request.ActorId, cancellationToken);
        }
        else
        {
            throw new ArgumentException("ActorId or Scope must be provided.", nameof(request.ActorId));
        }

        // Check exact duplicate before taking locks
        var exactDuplicate = await _memoryRepository.ExistsAsync(userId, request.Content, scopeId);
        if (exactDuplicate)
        {
            throw new ArgumentException("An identical memory already exists for this user.", nameof(request.Content));
        }

        var extractedMemory = new ExtractedMemory
        {
            Content = request.Content.Trim(),
            MemoryType = request.MemoryType
        };

        var jobId = Guid.NewGuid();
        long createdMemoryId = 0;

        // Atomic transaction boundary: persist Memory AND IngestionJob together.
        await _transactionCoordinator.ExecuteInTransactionAsync(async () =>
        {
            createdMemoryId = await _memoryRepository.CreateAsync(
                userId,
                extractedMemory,
                sourceChatId: null,
                scopeId: scopeId,
                occurredAt: request.OccurredAt,
                metadata: metadataJson,
                expiresAt: expiresAt,
                categories: normalizedCategories);

            var payload = JsonSerializer.Serialize(new CreateMemoryJobPayload
            {
                Content = request.Content.Trim(),
                MemoryType = request.MemoryType,
                Metadata = metadataJson,
                OccurredAt = request.OccurredAt,
                ExpiresAt = expiresAt,
                Categories = normalizedCategories
            });

            var jobRecord = new MemoryIngestionJobRecord
            {
                JobId = jobId,
                ProjectId = projectId,
                UserId = userId,
                ScopeId = scopeId,
                MemoryId = createdMemoryId,
                JobType = "CreateMemory",
                Status = "Pending",
                Payload = payload,
                Attempts = 0,
                MaxAttempts = 3,
                AvailableAt = DateTime.UtcNow,
                CreatedAt = DateTime.UtcNow
            };

            await _jobRepository.EnqueueJobAsync(jobRecord, cancellationToken);
        }, cancellationToken);

        _logger.LogInformation(
            "[AsyncIngestion] Enqueued CreateMemory job {JobId} for Memory {MemoryId}, UserId={UserId}, ProjectId={ProjectId}",
            jobId, createdMemoryId, userId, projectId);

        return new AsyncJobAcceptedResponse
        {
            JobId = jobId,
            MemoryId = createdMemoryId,
            Status = "Pending",
            CreatedAt = DateTime.UtcNow,
            Message = "Memory accepted for background extraction and embedding generation."
        };
    }

    /// <inheritdoc />
    public async Task<AsyncJobAcceptedResponse> EnqueueAsyncIngestConversationAsync(
        IngestConversationRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request?.ActorId) && (request?.Scope == null || request.Scope.IsEmpty))
        {
            throw new ArgumentException("actorId or scope is required and must not be empty.");
        }

        if (request.Messages == null || request.Messages.Count == 0)
        {
            throw new ArgumentException("messages must contain at least one entry.");
        }

        var jobId = Guid.NewGuid();
        var payload = JsonSerializer.Serialize(request);

        var jobRecord = new MemoryIngestionJobRecord
        {
            JobId = jobId,
            ProjectId = projectId,
            UserId = userId,
            ScopeId = null,
            MemoryId = null,
            JobType = "IngestConversation",
            Status = "Pending",
            Payload = payload,
            Attempts = 0,
            MaxAttempts = 3,
            AvailableAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };

        await _jobRepository.EnqueueJobAsync(jobRecord, cancellationToken);

        _logger.LogInformation(
            "[AsyncIngestion] Enqueued IngestConversation job {JobId}, UserId={UserId}, ProjectId={ProjectId}",
            jobId, userId, projectId);

        return new AsyncJobAcceptedResponse
        {
            JobId = jobId,
            Status = "Pending",
            CreatedAt = DateTime.UtcNow,
            Message = "Conversational messages accepted for background ingestion and extraction."
        };
    }

    /// <inheritdoc />
    public async Task<JobStatusResponse?> GetJobStatusAsync(
        Guid jobId,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default)
    {
        var job = await _jobRepository.GetJobAsync(jobId, userId, projectId, cancellationToken);
        if (job == null) return null;

        return new JobStatusResponse
        {
            JobId = job.JobId,
            JobType = job.JobType,
            Status = job.Status,
            MemoryId = job.MemoryId,
            Attempts = job.Attempts,
            MaxAttempts = job.MaxAttempts,
            LastError = job.LastError,
            CreatedAt = job.CreatedAt,
            CompletedAt = job.CompletedAt
        };
    }

    /// <inheritdoc />
    public async Task ProcessJobAsync(
        MemoryIngestionJobRecord job,
        CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("[AsyncWorker] Processing job {JobId} of type {JobType}", job.JobId, job.JobType);

        try
        {
            if (job.JobType == "CreateMemory")
            {
                await ProcessCreateMemoryJobAsync(job, cancellationToken);
            }
            else if (job.JobType == "IngestConversation")
            {
                await ProcessIngestConversationJobAsync(job, cancellationToken);
            }
            else
            {
                await _jobRepository.FailJobAsync(job.JobId, $"Unknown job type: {job.JobType}", canRetry: false, cancellationToken: cancellationToken);
                return;
            }

            await _jobRepository.CompleteJobAsync(job.JobId, cancellationToken);
            _logger.LogInformation("[AsyncWorker] Successfully completed job {JobId}", job.JobId);
        }
        catch (HttpRequestException httpEx)
        {
            _logger.LogWarning(httpEx, "[AsyncWorker] Transient HTTP failure processing job {JobId}", job.JobId);
            var delay = TimeSpan.FromSeconds(Math.Min(60, Math.Pow(2, job.Attempts) * 2));
            await _jobRepository.FailJobAsync(job.JobId, "Transient network failure contacting provider.", canRetry: true, retryDelay: delay, cancellationToken: cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "[AsyncWorker] Permanent or unexpected failure processing job {JobId}", job.JobId);
            await _jobRepository.FailJobAsync(job.JobId, ex.Message, canRetry: false, cancellationToken: cancellationToken);
        }
    }

    private async Task ProcessCreateMemoryJobAsync(
        MemoryIngestionJobRecord job,
        CancellationToken cancellationToken)
    {
        if (!job.MemoryId.HasValue)
        {
            await _jobRepository.FailJobAsync(job.JobId, "CreateMemory job missing MemoryId reference.", canRetry: false, cancellationToken: cancellationToken);
            return;
        }

        var memory = await _memoryRepository.GetMemorySnapshotForUserAsync(
            job.MemoryId.Value,
            job.UserId,
            job.ProjectId,
            job.ScopeId);

        if (memory == null)
        {
            await _jobRepository.CancelJobAsync(job.JobId, "Memory was deleted or does not exist.", cancellationToken);
            return;
        }

        if (memory.ExpiresAt.HasValue && memory.ExpiresAt.Value <= DateTime.UtcNow)
        {
            await _jobRepository.CancelJobAsync(job.JobId, "Memory expired prior to background execution.", cancellationToken);
            return;
        }

        // Generate and persist embedding
        var embedding = await _embeddingGenerator.GenerateAsync(memory.Content);
        await _memoryRepository.SaveEmbeddingAsync(memory.MemoryId, EmbeddingModel, embedding);

        // Non-fatal entity & graph extraction
        if (_entityExtractionService != null && _entityRepository != null && job.ScopeId.HasValue)
        {
            try
            {
                var extraction = await _entityExtractionService.ExtractFullAsync(memory.Content.Trim(), cancellationToken);
                var entities = extraction?.Entities ?? await _entityExtractionService.ExtractAsync(memory.Content.Trim(), cancellationToken);
                if (entities != null && entities.Count > 0)
                {
                    await _entityRepository.UpsertEntitiesForMemoryAsync(job.ProjectId, memory.MemoryId, entities, cancellationToken);
                }
                if (extraction?.Relationships != null && extraction.Relationships.Count > 0)
                {
                    await _entityRepository.UpsertRelationshipsForMemoryAsync(job.ProjectId, job.ScopeId.Value, memory.MemoryId, extraction.Relationships, cancellationToken);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "[AsyncWorker] Non-fatal entity extraction failure for Memory {MemoryId}", memory.MemoryId);
            }
        }
    }

    private async Task ProcessIngestConversationJobAsync(
        MemoryIngestionJobRecord job,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(job.Payload))
        {
            await _jobRepository.FailJobAsync(job.JobId, "IngestConversation job missing payload.", canRetry: false, cancellationToken: cancellationToken);
            return;
        }

        if (_ingestionService == null)
        {
            await _jobRepository.FailJobAsync(job.JobId, "MemoryIngestionService unavailable.", canRetry: false, cancellationToken: cancellationToken);
            return;
        }

        var request = JsonSerializer.Deserialize<IngestConversationRequest>(job.Payload);
        if (request == null)
        {
            await _jobRepository.FailJobAsync(job.JobId, "Failed to deserialize IngestConversationRequest payload.", canRetry: false, cancellationToken: cancellationToken);
            return;
        }

        await _ingestionService.IngestAsync(request, job.UserId, job.ProjectId, cancellationToken);
    }
}
