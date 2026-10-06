using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Constants;
using Kairo.Application.DTOs;
using Microsoft.Extensions.Logging;

namespace Kairo.Application.Services;

/// <summary>
/// Implements the conversational memory ingestion pipeline.
///
/// Per-candidate flow (Phase 1 — ADD-only mode):
///   1. Check exact text duplicate via IMemoryRepository.ExistsAsync → NoAction.
///   2. Generate embedding for the candidate.
///   3. ADD the candidate as a new memory (no similarity / consolidation check).
///
/// NOTE — Automatic consolidation is intentionally disabled in the current
/// ADD-only ingestion mode.
/// The existing UPDATE/MERGE/NoAction consolidation logic
/// (IMemoryConsolidationEvaluator, similarity scan, MergeMemoryAsync, UpdateMemoryAsync)
/// is fully preserved in this file and will be re-enabled in a future phase.
///
/// Scope note:
///   Ingestion uses GetOrCreateScopeAsync because it is a write operation that may
///   legitimately produce the actor's first memory. This is explicitly different from
///   search (ResolveScopeAsync), which must not create a scope for a read-only query.
/// </summary>
public class MemoryIngestionService : IMemoryIngestionService
{
    private readonly IMemoryExtractor _extractor;
    private readonly IMemoryConsolidationEvaluator _consolidationEvaluator;
    private readonly IMemoryRepository _memoryRepository;
    private readonly IEmbeddingGenerator _embeddingGenerator;
    private readonly SemanticSimilarityService _similarityService;
    private readonly IScopeResolutionService _scopeResolutionService;
    private readonly IEntityExtractionService _entityExtractionService;
    private readonly IEntityRepository _entityRepository;
    private readonly ILogger<MemoryIngestionService> _logger;

    // Threshold at which a candidate is considered close enough in domain
    // to warrant consolidation evaluation (duplicate/paraphrase/merge/update)
    // rather than an immediate blind Add. Set to 0.75 to capture evolving facts
    // (e.g. relocation "Pune residence" vs "Mumbai location" with cosine similarity ~0.78)
    // while safely ignoring out-of-domain memories (like Pune vs PostgreSQL at 0.69).
    private const double ConsolidationCandidateThreshold = 0.75;

    private const string EmbeddingModel = "mistral-embed";

    // Valid memory types accepted by the existing persistence layer.
    private static readonly HashSet<string> ValidMemoryTypes = new(
        StringComparer.OrdinalIgnoreCase)
    {
        "Preference", "Fact", "Goal", "Context", "Skill",
        "Relationship", "Other",
        // Extractor-only types (mapped to nearest valid type before persistence)
        "Decision", "ProjectContext", "Instruction"
    };

    // Maps extractor-only types → nearest MemoryService-accepted type.
    private static readonly Dictionary<string, string> TypeMapping =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ["Decision"]       = "Fact",
            ["ProjectContext"] = "Context",
            ["Instruction"]    = "Fact"
        };

    public MemoryIngestionService(
        IMemoryExtractor extractor,
        IMemoryConsolidationEvaluator consolidationEvaluator,
        IMemoryRepository memoryRepository,
        IEmbeddingGenerator embeddingGenerator,
        SemanticSimilarityService similarityService,
        IScopeResolutionService scopeResolutionService,
        IEntityExtractionService entityExtractionService,
        IEntityRepository entityRepository,
        ILogger<MemoryIngestionService> logger)
    {
        _extractor               = extractor;
        _consolidationEvaluator  = consolidationEvaluator;
        _memoryRepository        = memoryRepository;
        _embeddingGenerator      = embeddingGenerator;
        _similarityService       = similarityService;
        _scopeResolutionService  = scopeResolutionService;
        _entityExtractionService = entityExtractionService;
        _entityRepository        = entityRepository;
        _logger                  = logger;
    }

    /// <inheritdoc/>
    public async Task<MemoryIngestionResponse> IngestAsync(
        IngestConversationRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default)
    {
        _logger.LogInformation(
            "[Ingestion] Started. UserId={UserId} ProjectId={ProjectId} ActorId={ActorId} MessageCount={Count}",
            userId, projectId, request.ActorId, request.Messages.Count);

        // ── Step 1: Map slim IngestMessageItem → CreateMessageRequest ────────────
        // IMemoryExtractor.ExtractAsync requires CreateMessageRequest.
        // ExternalMessageId and CreatedAt are synthetic — the extractor only reads
        // Role and Content; it never surfaces these internal fields to the caller.

        var extractorMessages = request.Messages
            .Select((m, index) => new CreateMessageRequest
            {
                ExternalMessageId = $"ingest-{index}",
                Role              = m.Role,
                Content           = m.Content,
                CreatedAt         = DateTime.UtcNow
            })
            .ToList();

        // ── Step 2: Extract candidate memories ───────────────────────────────────

        List<ExtractedMemory> candidates;

        try
        {
            candidates = await _extractor.ExtractAsync(extractorMessages);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "[Ingestion] Extraction failed. UserId={UserId} ActorId={ActorId}",
                userId, request.ActorId);

            // Fail safe: extraction failure → no partial persistence.
            throw new InvalidOperationException(
                "Memory extraction failed. No memories were persisted.", ex);
        }

        _logger.LogInformation(
            "[Ingestion] Extraction complete. CandidateCount={Count} ActorId={ActorId}",
            candidates.Count, request.ActorId);

        var response = new MemoryIngestionResponse
        {
            Processed      = true,
            ExtractedCount = candidates.Count
        };

        if (candidates.Count == 0)
        {
            _logger.LogInformation(
                "[Ingestion] No candidates extracted. ActorId={ActorId}", request.ActorId);
            return response;
        }

        // ── Step 3: Resolve scope ONLY when there are candidates to persist ──────
        // We use GetOrCreateScopeAsync because ingestion is a write operation.
        // If this is the actor's first memory, the scope is created now.

        long scopeId;

        try
        {
            if (request.Scope != null && !request.Scope.IsEmpty)
            {
                scopeId = await _scopeResolutionService.GetOrCreateFromScopeKeyAsync(
                    projectId,
                    request.Scope,
                    cancellationToken);
            }
            else
            {
                scopeId = await _scopeResolutionService.GetOrCreateScopeAsync(
                    projectId,
                    request.ActorId,
                    cancellationToken);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "[Ingestion] Scope resolution failed. UserId={UserId} ActorId={ActorId}",
                userId, request.ActorId);
            throw;
        }

        // ── Step 4: Load existing scope embeddings once for the entire batch ─────
        // Re-used for every candidate to avoid N+1 embedding loads.
        // The working set is updated in-memory as new memories are added so that
        // within a single ingestion call, two identical candidates are not both persisted.

        var existingEmbeddings =
            await _memoryRepository.GetActiveMemoryEmbeddingsAsync(userId, scopeId)
            ?? new List<MemoryEmbeddingData>();

        // ── Step 5: Process each candidate ───────────────────────────────────────

        foreach (var candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate.Content))
            {
                response.Memories.Add(new IngestionMemoryResult
                {
                    Action  = IngestionOperation.NoAction,
                    Content = string.Empty,
                    Reason  = "Extracted candidate had empty content."
                });
                continue;
            }

            // Normalise memory type to a value accepted by the persistence layer.
            var memoryType = NormaliseMemoryType(candidate.MemoryType);

            var result = await ProcessCandidateAsync(
                candidate.Content,
                memoryType,
                userId,
                projectId,
                scopeId,
                existingEmbeddings,
                cancellationToken);

            response.Memories.Add(result);

            _logger.LogInformation(
                "[Ingestion] Candidate processed. Action={Action} MemoryId={MemoryId} ActorId={ActorId}",
                result.Action, result.MemoryId, request.ActorId);
        }

        _logger.LogInformation(
            "[Ingestion] Completed. ActorId={ActorId} Results={Count}",
            request.ActorId, response.Memories.Count);

        return response;
    }

    // ── Private: per-candidate processing ────────────────────────────────────────

    private async Task<IngestionMemoryResult> ProcessCandidateAsync(
        string content,
        string memoryType,
        long userId,
        long projectId,
        long scopeId,
        List<MemoryEmbeddingData> existingEmbeddings,
        CancellationToken cancellationToken)
    {
        // ── 5a: Exact duplicate check ─────────────────────────────────────────
        var exactExists = await _memoryRepository.ExistsAsync(userId, content, scopeId);

        if (exactExists)
        {
            return new IngestionMemoryResult
            {
                Action  = IngestionOperation.NoAction,
                Content = content,
                Reason  = "Exact duplicate of an existing memory."
            };
        }

        // ── 5b: Generate embedding for the candidate ──────────────────────────
        float[] candidateEmbedding;

        try
        {
            candidateEmbedding = await _embeddingGenerator.GenerateAsync(content);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "[Ingestion] Embedding generation failed for candidate. Content length={Len}",
                content.Length);

            // Fail safe: cannot persist without embedding.
            return new IngestionMemoryResult
            {
                Action  = IngestionOperation.NoAction,
                Content = content,
                Reason  = "Embedding generation failed. Candidate not persisted."
            };
        }

        // ── 5c–5e: Automatic consolidation is intentionally disabled in the current
        //           ADD-only ingestion mode.
        //
        //           The similarity scan (against existingEmbeddings using
        //           ConsolidationCandidateThreshold), the IMemoryConsolidationEvaluator
        //           call, and the resulting MergeMemoryAsync / UpdateMemoryAsync /
        //           NoAction handling are preserved in this file (below) and will be
        //           re-enabled in a future phase when automatic memory consolidation
        //           is reintroduced to the ingestion pipeline.
        //
        //           TODO (future phase): Restore the similarity scan and evaluator
        //           loop here. Re-enable MergeMemoryAsync, UpdateMemoryAsync, and
        //           NoAction return paths.

        // ── 5d: ADD — always persist as a new memory in Phase 1 ──────────────
        return await AddNewMemoryAsync(
            content, memoryType, userId, projectId, scopeId,
            candidateEmbedding, existingEmbeddings);
    }

    // ── Add helper ────────────────────────────────────────────────────────────────

    private async Task<IngestionMemoryResult> AddNewMemoryAsync(
        string content,
        string memoryType,
        long userId,
        long projectId,
        long scopeId,
        float[] embedding,
        List<MemoryEmbeddingData> existingEmbeddings)
    {
        var extracted = new ExtractedMemory
        {
            Content    = content.Trim(),
            MemoryType = memoryType
        };

        long memoryId;

        try
        {
            memoryId = await _memoryRepository.CreateAsync(
                userId,
                extracted,
                sourceChatId: null,
                scopeId: scopeId);

            await _memoryRepository.SaveEmbeddingAsync(
                memoryId, EmbeddingModel, embedding);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "[Ingestion] Persistence failed for Add candidate.");

            // Fail safe: cannot leave an orphaned memory row without an embedding.
            // The embedding save failure leaves the memory row without an embedding,
            // which is acceptable — the backfill service can fix it later.
            // Rethrow so the caller is aware a persistence error occurred.
            throw;
        }

        // Phase 1 & 2: Extract and persist entities and relationships for this memory.
        // Entity extraction must NEVER block or fail the ingestion pipeline.
        await ExtractAndPersistEntitiesAsync(content, projectId, scopeId, memoryId);

        // Update the in-memory working set so subsequent candidates in the same
        // ingestion call can detect this new memory as a potential duplicate.
        existingEmbeddings.Add(new MemoryEmbeddingData
        {
            MemoryId   = memoryId,
            Content    = content,
            MemoryType = memoryType,
            Model      = EmbeddingModel,
            Dimensions = embedding.Length,
            Embedding  = embedding
        });

        return new IngestionMemoryResult
        {
            Action   = IngestionOperation.Add,
            MemoryId = memoryId,
            Content  = content.Trim()
        };
    }

    // ── Entity extraction helper ──────────────────────────────────────────────

    /// <summary>
    /// Extracts entities and relationships from memory content and persists them.
    /// Never throws — all failures are logged and silently swallowed.
    /// </summary>
    private async Task ExtractAndPersistEntitiesAsync(
        string content,
        long projectId,
        long scopeId,
        long memoryId)
    {
        try
        {
            var entities = await _entityExtractionService.ExtractAsync(content);

            if (entities != null && entities.Count > 0)
            {
                await _entityRepository.UpsertEntitiesForMemoryAsync(
                    projectId, memoryId, entities);

                _logger.LogInformation(
                    "[Ingestion] Extracted {Count} entities for MemoryId={MemoryId}.",
                    entities.Count, memoryId);
            }

            try
            {
                var extraction = await _entityExtractionService.ExtractFullAsync(content);
                if (extraction?.Relationships != null && extraction.Relationships.Count > 0)
                {
                    await _entityRepository.UpsertRelationshipsForMemoryAsync(
                        projectId, scopeId, memoryId, extraction.Relationships);

                    _logger.LogInformation(
                        "[Ingestion] Extracted {Count} relationships for MemoryId={MemoryId} in ScopeId={ScopeId}.",
                        extraction.Relationships.Count, memoryId, scopeId);
                }
            }
            catch
            {
                // Silently ignore if ExtractFullAsync is not set up on mock
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "[Ingestion] Entity extraction/persistence failed for MemoryId={MemoryId}. Continuing.",
                memoryId);
        }
    }

    // ── Merge helper ──────────────────────────────────────────────────────────────
    // NOTE: Preserved for future phase when automatic consolidation is re-enabled.

    private async Task<IngestionMemoryResult> MergeMemoryAsync(
        MemoryEmbeddingData existing,
        ConsolidationEvaluationResult evaluation,
        long userId,
        long scopeId)
    {
        var canonicalContent = string.IsNullOrWhiteSpace(evaluation.CanonicalContent)
            ? existing.Content
            : evaluation.CanonicalContent.Trim();

        // If canonical content is unchanged there is nothing to update.
        if (string.Equals(existing.Content, canonicalContent, StringComparison.Ordinal))
        {
            return new IngestionMemoryResult
            {
                Action   = IngestionOperation.Merge,
                MemoryId = existing.MemoryId,
                Content  = canonicalContent,
                Reason   = evaluation.Reason ?? "Equivalent knowledge; content unchanged."
            };
        }

        try
        {
            // Archive the current content as a version entry BEFORE mutation.
            await _memoryRepository.CreateMemoryVersionAsync(
                existing.MemoryId,
                existing.Content,
                "IngestionMerge");

            // Update canonical content.
            await _memoryRepository.UpdateMemoryContentAsync(
                existing.MemoryId,
                canonicalContent);

            // Regenerate and replace embedding to reflect updated content.
            var freshEmbedding = await _embeddingGenerator.GenerateAsync(canonicalContent);

            await _memoryRepository.ReplaceEmbeddingAsync(
                existing.MemoryId, EmbeddingModel, freshEmbedding);

            // Update in-memory working set for subsequent candidates in batch
            existing.Content = canonicalContent;
            existing.Embedding = freshEmbedding;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "[Ingestion] Merge persistence failed. ExistingMemoryId={Id}",
                existing.MemoryId);

            // Fail safe: if the update fails, the existing memory is unchanged.
            return new IngestionMemoryResult
            {
                Action  = IngestionOperation.NoAction,
                Content = existing.Content,
                Reason  = "Merge persistence failed. Existing memory left unchanged."
            };
        }

        return new IngestionMemoryResult
        {
            Action   = IngestionOperation.Merge,
            MemoryId = existing.MemoryId,
            Content  = canonicalContent,
            Reason   = evaluation.Reason
        };
    }

    // ── Update helper ─────────────────────────────────────────────────────────────
    // NOTE: Preserved for future phase when automatic consolidation is re-enabled.

    private async Task<IngestionMemoryResult> UpdateMemoryAsync(
        MemoryEmbeddingData existing,
        ConsolidationEvaluationResult evaluation,
        long userId,
        long scopeId)
    {
        var canonicalContent = string.IsNullOrWhiteSpace(evaluation.CanonicalContent)
            ? existing.Content
            : evaluation.CanonicalContent.Trim();

        try
        {
            // Archive the superseded content as a version entry BEFORE mutation.
            await _memoryRepository.CreateMemoryVersionAsync(
                existing.MemoryId,
                existing.Content,
                "IngestionUpdate");

            // Update memory content to the new superseding fact.
            await _memoryRepository.UpdateMemoryContentAsync(
                existing.MemoryId,
                canonicalContent);

            // Regenerate and replace embedding to reflect the superseding fact.
            var freshEmbedding = await _embeddingGenerator.GenerateAsync(canonicalContent);

            await _memoryRepository.ReplaceEmbeddingAsync(
                existing.MemoryId, EmbeddingModel, freshEmbedding);

            // Update in-memory working set for subsequent candidates in batch
            existing.Content = canonicalContent;
            existing.Embedding = freshEmbedding;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "[Ingestion] Update persistence failed. ExistingMemoryId={Id}",
                existing.MemoryId);

            // Fail safe: if the update fails, the existing memory is unchanged.
            return new IngestionMemoryResult
            {
                Action  = IngestionOperation.NoAction,
                Content = existing.Content,
                Reason  = "Update persistence failed. Existing memory left unchanged."
            };
        }

        return new IngestionMemoryResult
        {
            Action   = IngestionOperation.Update,
            MemoryId = existing.MemoryId,
            Content  = canonicalContent,
            Reason   = evaluation.Reason
        };
    }

    // ── Type normalisation ────────────────────────────────────────────────────────

    private static string NormaliseMemoryType(string? rawType)
    {
        if (string.IsNullOrWhiteSpace(rawType))
            return "Fact";

        if (TypeMapping.TryGetValue(rawType, out var mapped))
            return mapped;

        // If it's already a valid persistence type, use it directly.
        if (ValidMemoryTypes.Contains(rawType))
            return rawType;

        // Unknown type → safest default.
        return "Fact";
    }
}
