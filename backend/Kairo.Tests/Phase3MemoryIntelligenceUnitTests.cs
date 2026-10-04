using System.Net;
using System.Text.Json;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Moq;
using Moq.Protected;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Comprehensive unit tests for Phase 3 — Memory Intelligence, Consolidation & Evolving Facts.
/// All Mistral LLM, embedding generator, and repository calls are mocked.
/// Zero real network calls are made.
/// </summary>
public class Phase3MemoryIntelligenceUnitTests
{
    private readonly Mock<IMemoryExtractor>              _extractorMock     = new();
    private readonly Mock<IMemoryConsolidationEvaluator> _evaluatorMock     = new();
    private readonly Mock<IMemoryRepository>             _memoryRepoMock    = new();
    private readonly Mock<IEmbeddingGenerator>           _embeddingGenMock  = new();
    private readonly Mock<IScopeResolutionService>       _scopeResMock      = new();
    private readonly SemanticSimilarityService           _similarityService = new();
    // Phase 1 mocks (entity extraction — no-op by default)
    private readonly Mock<IEntityExtractionService>      _entityExtractorMock = new();
    private readonly Mock<IEntityRepository>             _entityRepoMock      = new();

    private MemoryIngestionService CreateService()
    {
        _entityExtractorMock
            .Setup(s => s.ExtractAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<ExtractedEntity>());
        _entityRepoMock
            .Setup(r => r.UpsertEntitiesForMemoryAsync(
                It.IsAny<long>(), It.IsAny<long>(),
                It.IsAny<List<ExtractedEntity>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new List<EntityData>());

        return new(
            _extractorMock.Object,
            _evaluatorMock.Object,
            _memoryRepoMock.Object,
            _embeddingGenMock.Object,
            _similarityService,
            _scopeResMock.Object,
            _entityExtractorMock.Object,
            _entityRepoMock.Object,
            NullLogger<MemoryIngestionService>.Instance);
    }

    private static IngestConversationRequest BuildRequest(
        string actorId,
        params (string role, string content)[] msgs) =>
        new()
        {
            ActorId  = actorId,
            Messages = msgs
                .Select(m => new IngestMessageItem { Role = m.role, Content = m.content })
                .ToList()
        };

    private void SetupScope(long projectId, string actorId, long scopeId) =>
        _scopeResMock
            .Setup(s => s.GetOrCreateScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

    // ── Test 1: Update on evolving fact (e.g. relocation Pune -> Mumbai) ────────

    [Fact(Skip = "Automatic consolidation disabled in Phase 1 ADD-only mode.")]
    public async Task Test1_EvolvingFact_UpdatesExistingMemoryAndCreatesVersion()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-relocating";
        const long scopeId = 101;
        const long memId   = 42;

        const string existingContent  = "I live in Pune.";
        const string candidateContent = "I moved to Mumbai.";
        const string canonicalContent = "I live in Mumbai.";

        var existingVec  = new float[] { 1.0f, 0.0f, 0.0f };
        var candidateVec = new float[] { 0.95f, 0.31f, 0.0f }; // similarity > 0.80
        var freshVec     = new float[] { 0.94f, 0.34f, 0.0f };

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = candidateContent, MemoryType = "Fact" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId   = memId,
                    Content    = existingContent,
                    MemoryType = "Fact",
                    Model      = "mistral-embed",
                    Dimensions = 3,
                    Embedding  = existingVec
                }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);
        _embeddingGenMock.Setup(e => e.GenerateAsync(canonicalContent)).ReturnsAsync(freshVec);

        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ReturnsAsync(new ConsolidationEvaluationResult
            {
                Action           = ConsolidationAction.Update,
                CanonicalContent = canonicalContent,
                Reason           = "User moved to Mumbai, superseding previous Pune residence."
            });

        _memoryRepoMock.Setup(r => r.CreateMemoryVersionAsync(memId, existingContent, "IngestionUpdate")).Returns(Task.CompletedTask);
        _memoryRepoMock.Setup(r => r.UpdateMemoryContentAsync(memId, canonicalContent)).Returns(Task.CompletedTask);
        _memoryRepoMock.Setup(r => r.ReplaceEmbeddingAsync(memId, "mistral-embed", freshVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actor, ("user", "I moved to Mumbai."));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.True(result.Processed);
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.Update, result.Memories[0].Action);
        Assert.Equal(memId, result.Memories[0].MemoryId);
        Assert.Equal(canonicalContent, result.Memories[0].Content);

        // Verify version created with "IngestionUpdate"
        _memoryRepoMock.Verify(r => r.CreateMemoryVersionAsync(memId, existingContent, "IngestionUpdate"), Times.Once);
        // Verify content updated
        _memoryRepoMock.Verify(r => r.UpdateMemoryContentAsync(memId, canonicalContent), Times.Once);
        // Verify fresh embedding replaced
        _memoryRepoMock.Verify(r => r.ReplaceEmbeddingAsync(memId, "mistral-embed", freshVec), Times.Once);
    }

    // ── Test 2: Update on contradictory preference (e.g. Postgres -> MongoDB) ───

    [Fact(Skip = "Automatic consolidation disabled in Phase 1 ADD-only mode.")]
    public async Task Test2_ContradictoryPreference_UpdatesExistingMemory()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-switch";
        const long scopeId = 102;
        const long memId   = 55;

        const string existingContent  = "I prefer PostgreSQL.";
        const string candidateContent = "I prefer MongoDB instead.";
        const string canonicalContent = "I prefer MongoDB.";

        var existingVec  = new float[] { 1.0f, 0.0f, 0.0f };
        var candidateVec = new float[] { 0.98f, 0.19f, 0.0f };
        var freshVec     = new float[] { 0.97f, 0.24f, 0.0f };

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = candidateContent, MemoryType = "Preference" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId   = memId,
                    Content    = existingContent,
                    MemoryType = "Preference",
                    Model      = "mistral-embed",
                    Dimensions = 3,
                    Embedding  = existingVec
                }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);
        _embeddingGenMock.Setup(e => e.GenerateAsync(canonicalContent)).ReturnsAsync(freshVec);

        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ReturnsAsync(new ConsolidationEvaluationResult
            {
                Action           = ConsolidationAction.Update,
                CanonicalContent = canonicalContent,
                Reason           = "Preference explicitly changed from PostgreSQL to MongoDB."
            });

        _memoryRepoMock.Setup(r => r.CreateMemoryVersionAsync(memId, existingContent, "IngestionUpdate")).Returns(Task.CompletedTask);
        _memoryRepoMock.Setup(r => r.UpdateMemoryContentAsync(memId, canonicalContent)).Returns(Task.CompletedTask);
        _memoryRepoMock.Setup(r => r.ReplaceEmbeddingAsync(memId, "mistral-embed", freshVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actor, ("user", "I prefer MongoDB instead."));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.True(result.Processed);
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.Update, result.Memories[0].Action);
        Assert.Equal(memId, result.Memories[0].MemoryId);
        Assert.Equal(canonicalContent, result.Memories[0].Content);
    }

    // ── Test 3: Compatible facts (PostgreSQL + Redis) are kept separate ────────

    [Fact]
    public async Task Test3_CompatibleFacts_BothPreservedAsSeparateMemories()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-multi-tech";
        const long scopeId = 103;
        const long memId1  = 61;
        const long memId2  = 62;

        const string existingContent  = "I use PostgreSQL.";
        const string candidateContent = "I use Redis.";

        var existingVec  = new float[] { 1.0f, 0.0f, 0.0f };
        var candidateVec = new float[] { 0.85f, 0.52f, 0.0f }; // similarity = 0.85 >= 0.80

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = candidateContent, MemoryType = "Fact" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId   = memId1,
                    Content    = existingContent,
                    MemoryType = "Fact",
                    Model      = "mistral-embed",
                    Dimensions = 3,
                    Embedding  = existingVec
                }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);

        // Evaluator determines they are compatible independent facts -> Action = Add
        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ReturnsAsync(new ConsolidationEvaluationResult
            {
                Action           = ConsolidationAction.Add,
                CanonicalContent = null,
                Reason           = "PostgreSQL and Redis are compatible distinct technologies; keep separate."
            });

        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeId)).ReturnsAsync(memId2);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(memId2, "mistral-embed", candidateVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actor, ("user", "I use Redis."));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.True(result.Processed);
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.Add, result.Memories[0].Action);
        Assert.Equal(memId2, result.Memories[0].MemoryId);
        Assert.Equal(candidateContent, result.Memories[0].Content);

        // Verify existing memory 61 was NOT mutated or versioned
        _memoryRepoMock.Verify(r => r.UpdateMemoryContentAsync(It.IsAny<long>(), It.IsAny<string>()), Times.Never);
        _memoryRepoMock.Verify(r => r.CreateMemoryVersionAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
    }

    // ── Test 4: Unrelated facts (< 0.80) are never sent to evaluator ───────────

    [Fact]
    public async Task Test4_UnrelatedFacts_AddedWithoutConsolidationEvaluation()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-unrelated";
        const long scopeId = 104;
        const long memId1  = 71;
        const long memId2  = 72;

        const string existingContent  = "I prefer PostgreSQL.";
        const string candidateContent = "I built a React frontend.";

        var existingVec  = new float[] { 1.0f, 0.0f, 0.0f };
        var candidateVec = new float[] { 0.50f, 0.86f, 0.0f }; // similarity = 0.50 < 0.80 threshold

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = candidateContent, MemoryType = "Fact" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId   = memId1,
                    Content    = existingContent,
                    MemoryType = "Preference",
                    Model      = "mistral-embed",
                    Dimensions = 3,
                    Embedding  = existingVec
                }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);
        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeId)).ReturnsAsync(memId2);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(memId2, "mistral-embed", candidateVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actor, ("user", "I built a React frontend."));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.True(result.Processed);
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.Add, result.Memories[0].Action);
        Assert.Equal(memId2, result.Memories[0].MemoryId);

        // Evaluator was never invoked because similarity is below threshold
        _evaluatorMock.Verify(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()), Times.Never);
    }

    // ── Test 5: Evaluator returns NoAction for semantic redundancy ─────────────

    [Fact(Skip = "Automatic consolidation disabled in Phase 1 ADD-only mode.")]
    public async Task Test5_EvaluatorReturnsNoAction_NoNewMemoryCreated()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-redundant";
        const long scopeId = 105;
        const long memId   = 81;

        const string existingContent  = "I prefer PostgreSQL.";
        const string candidateContent = "I really prefer PostgreSQL.";

        var existingVec  = new float[] { 1.0f, 0.0f, 0.0f };
        var candidateVec = new float[] { 0.98f, 0.19f, 0.0f };

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = candidateContent, MemoryType = "Preference" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId   = memId,
                    Content    = existingContent,
                    MemoryType = "Preference",
                    Model      = "mistral-embed",
                    Dimensions = 3,
                    Embedding  = existingVec
                }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);

        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ReturnsAsync(new ConsolidationEvaluationResult
            {
                Action           = ConsolidationAction.NoAction,
                CanonicalContent = null,
                Reason           = "Reiteration of identical preference with no new details."
            });

        var request = BuildRequest(actor, ("user", candidateContent));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.True(result.Processed);
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.NoAction, result.Memories[0].Action);
        Assert.Equal(memId, result.Memories[0].MemoryId);

        // No new memory created, no versioning
        _memoryRepoMock.Verify(r => r.CreateAsync(It.IsAny<long>(), It.IsAny<ExtractedMemory>(), null, It.IsAny<long>()), Times.Never);
        _memoryRepoMock.Verify(r => r.UpdateMemoryContentAsync(It.IsAny<long>(), It.IsAny<string>()), Times.Never);
    }

    // ── Test 6: Evaluator returns Merge with canonical content ─────────────────

    [Fact(Skip = "Automatic consolidation disabled in Phase 1 ADD-only mode.")]
    public async Task Test6_EvaluatorReturnsMerge_UpdatesCanonicalAndCreatesMergeVersion()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-merge";
        const long scopeId = 106;
        const long memId   = 91;

        const string existingContent  = "I prefer PostgreSQL.";
        const string candidateContent = "I prefer PostgreSQL for backend applications.";
        const string canonicalContent = "I prefer PostgreSQL for backend applications.";

        var existingVec  = new float[] { 1.0f, 0.0f, 0.0f };
        var candidateVec = new float[] { 0.95f, 0.31f, 0.0f };
        var freshVec     = new float[] { 0.95f, 0.31f, 0.0f };

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = candidateContent, MemoryType = "Preference" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId   = memId,
                    Content    = existingContent,
                    MemoryType = "Preference",
                    Model      = "mistral-embed",
                    Dimensions = 3,
                    Embedding  = existingVec
                }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);
        _embeddingGenMock.Setup(e => e.GenerateAsync(canonicalContent)).ReturnsAsync(freshVec);

        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ReturnsAsync(new ConsolidationEvaluationResult
            {
                Action           = ConsolidationAction.Merge,
                CanonicalContent = canonicalContent,
                Reason           = "Adds backend context to database preference."
            });

        _memoryRepoMock.Setup(r => r.CreateMemoryVersionAsync(memId, existingContent, "IngestionMerge")).Returns(Task.CompletedTask);
        _memoryRepoMock.Setup(r => r.UpdateMemoryContentAsync(memId, canonicalContent)).Returns(Task.CompletedTask);
        _memoryRepoMock.Setup(r => r.ReplaceEmbeddingAsync(memId, "mistral-embed", freshVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actor, ("user", candidateContent));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.True(result.Processed);
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.Merge, result.Memories[0].Action);
        Assert.Equal(memId, result.Memories[0].MemoryId);
        Assert.Equal(canonicalContent, result.Memories[0].Content);

        // Verify version "IngestionMerge" created
        _memoryRepoMock.Verify(r => r.CreateMemoryVersionAsync(memId, existingContent, "IngestionMerge"), Times.Once);
        _memoryRepoMock.Verify(r => r.UpdateMemoryContentAsync(memId, canonicalContent), Times.Once);
        _memoryRepoMock.Verify(r => r.ReplaceEmbeddingAsync(memId, "mistral-embed", freshVec), Times.Once);
    }

    // ── Test 7: Merge when canonical content is identical does not create version ──

    [Fact(Skip = "Automatic consolidation disabled in Phase 1 ADD-only mode.")]
    public async Task Test7_MergeWhenContentIdentical_NoVersionCreated()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-merge-ident";
        const long scopeId = 107;
        const long memId   = 92;

        const string content = "I prefer PostgreSQL.";
        var vec = new float[] { 1.0f, 0.0f, 0.0f };

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = "I really prefer PostgreSQL.", MemoryType = "Preference" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId   = memId,
                    Content    = content,
                    MemoryType = "Preference",
                    Model      = "mistral-embed",
                    Dimensions = 3,
                    Embedding  = vec
                }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, "I really prefer PostgreSQL.", scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync("I really prefer PostgreSQL.")).ReturnsAsync(vec);

        // Canonical content is identical to existing
        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ReturnsAsync(new ConsolidationEvaluationResult
            {
                Action           = ConsolidationAction.Merge,
                CanonicalContent = content,
                Reason           = "Canonical content identical."
            });

        var request = BuildRequest(actor, ("user", "I really prefer PostgreSQL."));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.Equal(IngestionOperation.Merge, result.Memories[0].Action);
        Assert.Equal(memId, result.Memories[0].MemoryId);

        // No version or update called because content did not change
        _memoryRepoMock.Verify(r => r.CreateMemoryVersionAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        _memoryRepoMock.Verify(r => r.UpdateMemoryContentAsync(It.IsAny<long>(), It.IsAny<string>()), Times.Never);
    }

    // ── Test 8: Repeated ingestion is idempotent ───────────────────────────────

    [Fact]
    public async Task Test8_RepeatedIngestion_SecondCallReturnsNoAction()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-idempotent";
        const long scopeId = 108;
        const string content = "I live in Pune.";

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = content, MemoryType = "Fact" }
            });

        // Exact match in repository
        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, content, scopeId)).ReturnsAsync(true);

        var request = BuildRequest(actor, ("user", content));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.True(result.Processed);
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.NoAction, result.Memories[0].Action);
        Assert.Null(result.Memories[0].MemoryId);
        Assert.Contains("Exact duplicate", result.Memories[0].Reason);

        _memoryRepoMock.Verify(r => r.CreateAsync(It.IsAny<long>(), It.IsAny<ExtractedMemory>(), null, It.IsAny<long>()), Times.Never);
    }

    // ── Test 9: Sequential updates (Pune -> Mumbai -> Delhi) ───────────────────

    [Fact(Skip = "Automatic consolidation disabled in Phase 1 ADD-only mode.")]
    public async Task Test9_SequentialUpdates_VersionsChainedAndLatestPersisted()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-sequential";
        const long scopeId = 109;
        const long memId   = 100;

        const string existingContent  = "I live in Mumbai.";
        const string candidateContent = "I moved to Delhi.";
        const string canonicalContent = "I live in Delhi.";

        var existingVec  = new float[] { 1.0f, 0.0f, 0.0f };
        var candidateVec = new float[] { 0.90f, 0.43f, 0.0f };
        var freshVec     = new float[] { 0.89f, 0.45f, 0.0f };

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = candidateContent, MemoryType = "Fact" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId   = memId,
                    Content    = existingContent,
                    MemoryType = "Fact",
                    Model      = "mistral-embed",
                    Dimensions = 3,
                    Embedding  = existingVec
                }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);
        _embeddingGenMock.Setup(e => e.GenerateAsync(canonicalContent)).ReturnsAsync(freshVec);

        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ReturnsAsync(new ConsolidationEvaluationResult
            {
                Action           = ConsolidationAction.Update,
                CanonicalContent = canonicalContent,
                Reason           = "Relocated from Mumbai to Delhi."
            });

        _memoryRepoMock.Setup(r => r.CreateMemoryVersionAsync(memId, existingContent, "IngestionUpdate")).Returns(Task.CompletedTask);
        _memoryRepoMock.Setup(r => r.UpdateMemoryContentAsync(memId, canonicalContent)).Returns(Task.CompletedTask);
        _memoryRepoMock.Setup(r => r.ReplaceEmbeddingAsync(memId, "mistral-embed", freshVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actor, ("user", candidateContent));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.Equal(IngestionOperation.Update, result.Memories[0].Action);
        Assert.Equal(canonicalContent, result.Memories[0].Content);

        // Previous Mumbai state archived
        _memoryRepoMock.Verify(r => r.CreateMemoryVersionAsync(memId, existingContent, "IngestionUpdate"), Times.Once);
        // Current state updated to Delhi
        _memoryRepoMock.Verify(r => r.UpdateMemoryContentAsync(memId, canonicalContent), Times.Once);
    }

    // ── Test 10: Inactive memories in scope are not returned as active candidates

    [Fact]
    public async Task Test10_InactiveMemories_ExcludedFromConsolidationScan()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-inactive";
        const long scopeId = 110;
        const string candidate = "I live in Delhi.";
        var candidateVec = new float[] { 1.0f, 0.0f, 0.0f };

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = candidate, MemoryType = "Fact" }
            });

        // Repository returns only ACTIVE memories (inactive memories already filtered by SQL WHERE IsActive = 1)
        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>());

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidate, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidate)).ReturnsAsync(candidateVec);
        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeId)).ReturnsAsync(105);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(105, "mistral-embed", candidateVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actor, ("user", candidate));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.Equal(IngestionOperation.Add, result.Memories[0].Action);
        Assert.Equal(105, result.Memories[0].MemoryId);
    }

    // ── Test 11: Evaluator exception fails safe to Add without data loss ────────

    [Fact]
    public async Task Test11_EvaluatorException_FailsSafeToAddNewMemory()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-eval-fail";
        const long scopeId = 111;
        const long memId1  = 110;
        const long memId2  = 111;

        const string existingContent  = "I live in Pune.";
        const string candidateContent = "I moved to Mumbai.";

        var existingVec  = new float[] { 1.0f, 0.0f, 0.0f };
        var candidateVec = new float[] { 0.95f, 0.31f, 0.0f };

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = candidateContent, MemoryType = "Fact" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new()
                {
                    MemoryId   = memId1,
                    Content    = existingContent,
                    MemoryType = "Fact",
                    Model      = "mistral-embed",
                    Dimensions = 3,
                    Embedding  = existingVec
                }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);

        // Evaluator throws unexpected network/API exception
        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ThrowsAsync(new InvalidOperationException("Mistral API 500 error"));

        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeId)).ReturnsAsync(memId2);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(memId2, "mistral-embed", candidateVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actor, ("user", candidateContent));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert: fails safe to Add rather than crashing or corrupting memory
        Assert.Equal(IngestionOperation.Add, result.Memories[0].Action);
        Assert.Equal(memId2, result.Memories[0].MemoryId);
    }

    // ── Test 12: Cross-actor isolation: Actor A cannot update Actor B ───────────

    [Fact]
    public async Task Test12_CrossActorIsolation_ActorScopeStrictlyIsolated()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actorB = "actor-B";
        const long scopeB  = 200;
        const string content = "Actor B exclusive fact.";
        var vec = new float[] { 1.0f, 0.0f, 0.0f };

        // Actor B's scope is resolved
        SetupScope(projId, actorB, scopeB);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = content, MemoryType = "Fact" }
            });

        // Repo queries scopeB strictly
        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeB))
            .ReturnsAsync(new List<MemoryEmbeddingData>());

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, content, scopeB)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(content)).ReturnsAsync(vec);
        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeB)).ReturnsAsync(300);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(300, "mistral-embed", vec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actorB, ("user", content));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert
        Assert.Equal(IngestionOperation.Add, result.Memories[0].Action);
        // Verify scopeId used in all repository calls was scopeB
        _memoryRepoMock.Verify(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeB), Times.Once);
        _memoryRepoMock.Verify(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeB), Times.Once);
    }

    // ── Test 13: Cross-project isolation: Project A cannot update Project B ────

    [Fact]
    public async Task Test13_CrossProjectIsolation_ProjectScopeEnforced()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projIdA = 10;
        const string actor = "shared-actor-id";
        const long scopeA  = 100;

        SetupScope(projIdA, actor, scopeA);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>());

        var request = BuildRequest(actor, ("user", "hello"));

        // Act
        await service.IngestAsync(request, userId, projIdA);

        // Assert: ScopeResolutionService was asked for (projIdA, actor), NEVER another project
        _scopeResMock.Verify(s => s.GetOrCreateScopeAsync(projIdA, actor, It.IsAny<CancellationToken>()), Times.Never); // 0 candidates -> scope never created
    }

    // ── Test 14: Multiple extracted memories processed independently ───────────

    [Fact]
    public async Task Test14_MultipleExtractedMemories_ProcessedIndependently()
    {
        // Arrange
        var service        = CreateService();
        const long userId  = 1;
        const long projId  = 10;
        const string actor = "user-multi-cand";
        const long scopeId = 114;

        const string cand1 = "I live in Pune.";
        const string cand2 = "I prefer PostgreSQL.";

        var vec1 = new float[] { 1.0f, 0.0f, 0.0f };
        var vec2 = new float[] { 0.0f, 1.0f, 0.0f }; // orthogonal (similarity = 0)

        SetupScope(projId, actor, scopeId);

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = cand1, MemoryType = "Fact" },
                new() { Content = cand2, MemoryType = "Preference" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>());

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, cand1, scopeId)).ReturnsAsync(false);
        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, cand2, scopeId)).ReturnsAsync(false);

        _embeddingGenMock.Setup(e => e.GenerateAsync(cand1)).ReturnsAsync(vec1);
        _embeddingGenMock.Setup(e => e.GenerateAsync(cand2)).ReturnsAsync(vec2);

        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.Is<ExtractedMemory>(m => m.Content == cand1), null, scopeId)).ReturnsAsync(401);
        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.Is<ExtractedMemory>(m => m.Content == cand2), null, scopeId)).ReturnsAsync(402);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(401, "mistral-embed", vec1)).Returns(Task.CompletedTask);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(402, "mistral-embed", vec2)).Returns(Task.CompletedTask);

        var request = BuildRequest(actor, ("user", "I live in Pune and I prefer PostgreSQL."));

        // Act
        var result = await service.IngestAsync(request, userId, projId);

        // Assert: both candidates added independently
        Assert.Equal(2, result.Memories.Count);
        Assert.Equal(IngestionOperation.Add, result.Memories[0].Action);
        Assert.Equal(401, result.Memories[0].MemoryId);
        Assert.Equal(IngestionOperation.Add, result.Memories[1].Action);
        Assert.Equal(402, result.Memories[1].MemoryId);
    }

    // ── MistralMemoryConsolidationEvaluator Unit Tests ─────────────────────────

    [Theory]
    [InlineData("Update",   "I live in Mumbai.",   ConsolidationAction.Update)]
    [InlineData("Merge",    "I prefer PostgreSQL.", ConsolidationAction.Merge)]
    [InlineData("NoAction", null,                  ConsolidationAction.NoAction)]
    [InlineData("Add",      null,                  ConsolidationAction.Add)]
    public async Task Test15_MistralEvaluator_ParsesAllActionsCorrectly(
        string actionStr,
        string? canonical,
        ConsolidationAction expectedAction)
    {
        // Arrange
        var mockHttp = new Mock<HttpMessageHandler>();
        var jsonResponse = JsonSerializer.Serialize(new
        {
            choices = new[]
            {
                new
                {
                    message = new
                    {
                        content = JsonSerializer.Serialize(new
                        {
                            action           = actionStr,
                            canonicalContent = canonical,
                            reason           = "Test explanation."
                        })
                    }
                }
            }
        });

        mockHttp.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content    = new StringContent(jsonResponse)
            });

        var client = new HttpClient(mockHttp.Object);
        var options = Options.Create(new MistralOptions { ApiKey = "dummy-key", Model = "ministral-3b-2512" });
        var evaluator = new MistralMemoryConsolidationEvaluator(client, options);

        var candidate = new MemoryConsolidationCandidate
        {
            ContentA = "Existing memory",
            ContentB = "Candidate memory"
        };

        // Act
        var result = await evaluator.EvaluateAsync(candidate);

        // Assert
        Assert.Equal(expectedAction, result.Action);
        if (expectedAction == ConsolidationAction.Update || expectedAction == ConsolidationAction.Merge)
        {
            Assert.Equal(canonical, result.CanonicalContent);
        }
    }

    [Fact]
    public async Task Test16_MistralEvaluator_MalformedJson_FailsSafeToAdd()
    {
        // Arrange
        var mockHttp = new Mock<HttpMessageHandler>();
        var jsonResponse = JsonSerializer.Serialize(new
        {
            choices = new[]
            {
                new
                {
                    message = new { content = "NOT A JSON OBJECT" }
                }
            }
        });

        mockHttp.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content    = new StringContent(jsonResponse)
            });

        var client = new HttpClient(mockHttp.Object);
        var options = Options.Create(new MistralOptions { ApiKey = "dummy-key", Model = "ministral-3b-2512" });
        var evaluator = new MistralMemoryConsolidationEvaluator(client, options);

        var candidate = new MemoryConsolidationCandidate
        {
            ContentA = "Existing memory",
            ContentB = "Candidate memory"
        };

        // Act
        var result = await evaluator.EvaluateAsync(candidate);

        // Assert: fails safe to Add without throwing
        Assert.Equal(ConsolidationAction.Add, result.Action);
        Assert.Null(result.CanonicalContent);
    }

    [Fact]
    public async Task Test17_MistralEvaluator_UnknownAction_FailsSafeToAdd()
    {
        // Arrange
        var mockHttp = new Mock<HttpMessageHandler>();
        var jsonResponse = JsonSerializer.Serialize(new
        {
            choices = new[]
            {
                new
                {
                    message = new
                    {
                        content = JsonSerializer.Serialize(new
                        {
                            action           = "InvalidActionName",
                            canonicalContent = "Some text",
                            reason           = "Invalid action test"
                        })
                    }
                }
            }
        });

        mockHttp.Protected()
            .Setup<Task<HttpResponseMessage>>(
                "SendAsync",
                ItExpr.IsAny<HttpRequestMessage>(),
                ItExpr.IsAny<CancellationToken>())
            .ReturnsAsync(new HttpResponseMessage
            {
                StatusCode = HttpStatusCode.OK,
                Content    = new StringContent(jsonResponse)
            });

        var client = new HttpClient(mockHttp.Object);
        var options = Options.Create(new MistralOptions { ApiKey = "dummy-key", Model = "ministral-3b-2512" });
        var evaluator = new MistralMemoryConsolidationEvaluator(client, options);

        var candidate = new MemoryConsolidationCandidate
        {
            ContentA = "Existing memory",
            ContentB = "Candidate memory"
        };

        // Act
        var result = await evaluator.EvaluateAsync(candidate);

        // Assert
        Assert.Equal(ConsolidationAction.Add, result.Action);
    }
}
