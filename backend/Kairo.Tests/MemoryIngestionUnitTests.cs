using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Unit tests for Phase 2 — MemoryIngestionService.
/// All Mistral / embedding / repository calls are mocked.
/// No real network calls are made.
/// </summary>
public class MemoryIngestionUnitTests
{
    // ── Shared mocks ──────────────────────────────────────────────────────────

    private readonly Mock<IMemoryExtractor>                _extractorMock        = new();
    private readonly Mock<IMemoryConsolidationEvaluator>   _evaluatorMock        = new();
    private readonly Mock<IMemoryRepository>               _memoryRepoMock       = new();
    private readonly Mock<IEmbeddingGenerator>             _embeddingGenMock     = new();
    private readonly Mock<IScopeResolutionService>         _scopeResMock         = new();
    private readonly SemanticSimilarityService             _similarityService    = new();

    private MemoryIngestionService CreateService() =>
        new(
            _extractorMock.Object,
            _evaluatorMock.Object,
            _memoryRepoMock.Object,
            _embeddingGenMock.Object,
            _similarityService,
            _scopeResMock.Object,
            NullLogger<MemoryIngestionService>.Instance);

    // ── Helpers ───────────────────────────────────────────────────────────────

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

    private void SetupScopeCreation(long projectId, string actorId, long scopeId) =>
        _scopeResMock
            .Setup(s => s.GetOrCreateScopeAsync(projectId, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeId);

    private void SetupExtract(params (string content, string type)[] candidates) =>
        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(candidates
                .Select(c => new ExtractedMemory { Content = c.content, MemoryType = c.type })
                .ToList());

    private void SetupNoExistingMemories(long userId, long scopeId) =>
        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>());

    private void SetupEmbedding(string content, float[] vec) =>
        _embeddingGenMock
            .Setup(e => e.GenerateAsync(content))
            .ReturnsAsync(vec);

    private void SetupNotExactDuplicate(long userId, string content, long scopeId) =>
        _memoryRepoMock
            .Setup(r => r.ExistsAsync(userId, content, scopeId))
            .ReturnsAsync(false);

    private void SetupCreateMemory(long userId, long scopeId, long returnId) =>
        _memoryRepoMock
            .Setup(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeId))
            .ReturnsAsync(returnId);

    // ── Test 1: Basic extraction — preference is persisted ────────────────────

    [Fact]
    public async Task Test1_BasicExtraction_PreferencePersisted()
    {
        // Arrange
        var service    = CreateService();
        const long     userId    = 1;
        const long     projectId = 10;
        const string   actorId   = "actor-t1";
        const long     scopeId   = 100;
        const string   content   = "I prefer PostgreSQL for backend applications.";
        const long     memId     = 42;
        var            embedding = new float[] { 1.0f, 0.0f, 0.0f };

        SetupScopeCreation(projectId, actorId, scopeId);
        SetupExtract((content, "Preference"));
        SetupNoExistingMemories(userId, scopeId);
        SetupNotExactDuplicate(userId, content, scopeId);
        SetupEmbedding(content, embedding);
        SetupCreateMemory(userId, scopeId, memId);

        _memoryRepoMock
            .Setup(r => r.SaveEmbeddingAsync(memId, "mistral-embed", embedding))
            .Returns(Task.CompletedTask);

        var request = BuildRequest(actorId, ("user", "I prefer PostgreSQL for backend applications."));

        // Act
        var result = await service.IngestAsync(request, userId, projectId);

        // Assert
        Assert.True(result.Processed);
        Assert.Equal(1, result.ExtractedCount);
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.Add, result.Memories[0].Action);
        Assert.Equal(memId, result.Memories[0].MemoryId);
        Assert.Equal(content, result.Memories[0].Content);

        // Verify persist was called
        _memoryRepoMock.Verify(r =>
            r.CreateAsync(userId, It.Is<ExtractedMemory>(m => m.Content == content), null, scopeId),
            Times.Once);
        _memoryRepoMock.Verify(r =>
            r.SaveEmbeddingAsync(memId, "mistral-embed", embedding),
            Times.Once);
    }

    // ── Test 2: No meaningful memory (greeting/filler) ────────────────────────

    [Fact]
    public async Task Test2_NoMeaningfulMemory_ExtractorReturnsEmpty_NoAction()
    {
        // Arrange
        var service    = CreateService();
        const long     userId    = 1;
        const long     projectId = 10;
        const string   actorId   = "actor-t2";

        // Extractor correctly returns empty for greeting/filler
        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>());

        var request = BuildRequest(actorId,
            ("user", "Hello"),
            ("assistant", "Hi!"),
            ("user", "Thanks."));

        // Act
        var result = await service.IngestAsync(request, userId, projectId);

        // Assert
        Assert.True(result.Processed);
        Assert.Equal(0, result.ExtractedCount);
        Assert.Empty(result.Memories);

        // Scope must NOT be created when no candidates extracted
        _scopeResMock.Verify(s =>
            s.GetOrCreateScopeAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);

        // Nothing persisted
        _memoryRepoMock.Verify(r =>
            r.CreateAsync(It.IsAny<long>(), It.IsAny<ExtractedMemory>(), It.IsAny<long?>(), It.IsAny<long?>()),
            Times.Never);
    }

    // ── Test 3: Multiple independent candidates ───────────────────────────────

    [Fact]
    public async Task Test3_MultipleMemories_BothPersisted()
    {
        // Arrange
        var service    = CreateService();
        const long     userId    = 1;
        const long     projectId = 10;
        const string   actorId   = "actor-t3";
        const long     scopeId   = 200;
        const string   contentA  = "I prefer PostgreSQL.";
        const string   contentB  = "I work in Go.";
        var            vecA      = new float[] { 1.0f, 0.0f, 0.0f };
        var            vecB      = new float[] { 0.0f, 1.0f, 0.0f };

        SetupScopeCreation(projectId, actorId, scopeId);
        SetupExtract((contentA, "Preference"), (contentB, "Fact"));

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>());

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, contentA, scopeId)).ReturnsAsync(false);
        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, contentB, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(contentA)).ReturnsAsync(vecA);
        _embeddingGenMock.Setup(e => e.GenerateAsync(contentB)).ReturnsAsync(vecB);
        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.Is<ExtractedMemory>(m => m.Content == contentA), null, scopeId)).ReturnsAsync(1);
        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.Is<ExtractedMemory>(m => m.Content == contentB), null, scopeId)).ReturnsAsync(2);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(It.IsAny<long>(), "mistral-embed", It.IsAny<float[]>())).Returns(Task.CompletedTask);

        var request = BuildRequest(actorId, ("user", "I prefer PostgreSQL and work in Go."));

        // Act
        var result = await service.IngestAsync(request, userId, projectId);

        // Assert
        Assert.True(result.Processed);
        Assert.Equal(2, result.ExtractedCount);
        Assert.Equal(2, result.Memories.Count);
        Assert.All(result.Memories, m => Assert.Equal(IngestionOperation.Add, m.Action));

        _memoryRepoMock.Verify(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeId), Times.Exactly(2));
    }

    // ── Test 4: Equivalent existing memory → NoAction (exact duplicate) ───────

    [Fact]
    public async Task Test4_ExactDuplicate_NoActionReturned()
    {
        // Arrange
        var service    = CreateService();
        const long     userId    = 1;
        const long     projectId = 10;
        const string   actorId   = "actor-t4";
        const long     scopeId   = 300;
        const string   content   = "I prefer PostgreSQL.";

        SetupScopeCreation(projectId, actorId, scopeId);
        SetupExtract((content, "Preference"));

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = 99, Content = content, MemoryType = "Preference",
                        Model = "mistral-embed", Dimensions = 3,
                        Embedding = new float[] { 1.0f, 0.0f, 0.0f } }
            });

        // Exact duplicate guard fires before embedding is generated
        _memoryRepoMock
            .Setup(r => r.ExistsAsync(userId, content, scopeId))
            .ReturnsAsync(true);

        var request = BuildRequest(actorId, ("user", "I prefer PostgreSQL."));

        // Act
        var result = await service.IngestAsync(request, userId, projectId);

        // Assert
        Assert.True(result.Processed);
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.NoAction, result.Memories[0].Action);

        // Nothing persisted
        _memoryRepoMock.Verify(r =>
            r.CreateAsync(It.IsAny<long>(), It.IsAny<ExtractedMemory>(), It.IsAny<long?>(), It.IsAny<long?>()),
            Times.Never);
        // Embedding not generated (short-circuit)
        _embeddingGenMock.Verify(e => e.GenerateAsync(content), Times.Never);
    }

    // ── Test 5: Update/Merge — consolidation evaluator says IsSameKnowledge ───

    [Fact]
    public async Task Test5_ConsolidationMerge_ExistingMemoryUpdated()
    {
        // Arrange
        var service    = CreateService();
        const long     userId    = 1;
        const long     projectId = 10;
        const string   actorId   = "actor-t5";
        const long     scopeId   = 400;
        const long     existingId = 77;
        const string   existingContent  = "I prefer PostgreSQL.";
        const string   candidateContent = "For backend projects, I prefer PostgreSQL.";
        const string   canonicalContent = "I prefer PostgreSQL for backend projects.";
        var            existingVec      = new float[] { 1.0f, 0.0f, 0.0f };
        var            candidateVec     = new float[] { 0.98f, 0.02f, 0.0f }; // high similarity

        SetupScopeCreation(projectId, actorId, scopeId);
        SetupExtract((candidateContent, "Preference"));

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = existingId, Content = existingContent, MemoryType = "Preference",
                        Model = "mistral-embed", Dimensions = 3, Embedding = existingVec }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);

        // Consolidation evaluator confirms same knowledge
        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.Is<MemoryConsolidationCandidate>(c =>
                c.MemoryIdA == existingId && c.ContentB == candidateContent)))
            .ReturnsAsync(new ConsolidationEvaluationResult
            {
                IsSameKnowledge  = true,
                CanonicalContent = canonicalContent,
                Reason           = "Both express the same PostgreSQL preference."
            });

        // Merge persistence
        var freshVec = new float[] { 0.99f, 0.01f, 0.0f };
        _memoryRepoMock.Setup(r => r.CreateMemoryVersionAsync(existingId, existingContent, "IngestionMerge")).Returns(Task.CompletedTask);
        _memoryRepoMock.Setup(r => r.UpdateMemoryContentAsync(existingId, canonicalContent)).Returns(Task.CompletedTask);
        _embeddingGenMock.Setup(e => e.GenerateAsync(canonicalContent)).ReturnsAsync(freshVec);
        _memoryRepoMock.Setup(r => r.ReplaceEmbeddingAsync(existingId, "mistral-embed", freshVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actorId, ("user", "For backend projects, I prefer PostgreSQL."));

        // Act
        var result = await service.IngestAsync(request, userId, projectId);

        // Assert
        Assert.True(result.Processed);
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.Merge, result.Memories[0].Action);
        Assert.Equal(existingId, result.Memories[0].MemoryId);
        Assert.Equal(canonicalContent, result.Memories[0].Content);

        // Verify version was created and memory was updated
        _memoryRepoMock.Verify(r => r.CreateMemoryVersionAsync(existingId, existingContent, "IngestionMerge"), Times.Once);
        _memoryRepoMock.Verify(r => r.UpdateMemoryContentAsync(existingId, canonicalContent), Times.Once);
        _memoryRepoMock.Verify(r => r.ReplaceEmbeddingAsync(existingId, "mistral-embed", freshVec), Times.Once);

        // No new memory was created
        _memoryRepoMock.Verify(r =>
            r.CreateAsync(It.IsAny<long>(), It.IsAny<ExtractedMemory>(), It.IsAny<long?>(), It.IsAny<long?>()),
            Times.Never);
    }

    // ── Test 6: Merge — canonicalContent unchanged → content-equal merge ──────

    [Fact]
    public async Task Test6_MergeContentIdentical_NoVersionCreated()
    {
        // Arrange
        var service   = CreateService();
        const long    userId    = 1;
        const long    projectId = 10;
        const string  actorId   = "actor-t6";
        const long    scopeId   = 500;
        const long    existingId = 55;
        const string  existingContent  = "I prefer PostgreSQL.";
        const string  candidateContent = "I really prefer PostgreSQL.";
        var           existingVec      = new float[] { 1.0f, 0.0f, 0.0f };
        var           candidateVec     = new float[] { 0.97f, 0.03f, 0.0f };

        SetupScopeCreation(projectId, actorId, scopeId);
        SetupExtract((candidateContent, "Preference"));

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = existingId, Content = existingContent, MemoryType = "Preference",
                        Model = "mistral-embed", Dimensions = 3, Embedding = existingVec }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);

        // Evaluator returns same knowledge but canonical content == existing content
        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ReturnsAsync(new ConsolidationEvaluationResult
            {
                IsSameKnowledge  = true,
                CanonicalContent = existingContent,   // <── same as current
                Reason           = "Identical knowledge."
            });

        var request = BuildRequest(actorId, ("user", candidateContent));

        // Act
        var result = await service.IngestAsync(request, userId, projectId);

        // Assert
        Assert.Equal(IngestionOperation.Merge, result.Memories[0].Action);
        Assert.Equal(existingId, result.Memories[0].MemoryId);
        Assert.Equal(existingContent, result.Memories[0].Content);

        // Content unchanged → no version, no update, no embedding replacement
        _memoryRepoMock.Verify(r => r.CreateMemoryVersionAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        _memoryRepoMock.Verify(r => r.UpdateMemoryContentAsync(It.IsAny<long>(), It.IsAny<string>()), Times.Never);
        _memoryRepoMock.Verify(r => r.ReplaceEmbeddingAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<float[]>()), Times.Never);
    }

    // ── Test 7: NoAction — evaluator says different knowledge → Add ──────────

    [Fact]
    public async Task Test7_EvaluatorDifferentKnowledge_AddsNewMemory()
    {
        // Arrange
        var service    = CreateService();
        const long     userId    = 1;
        const long     projectId = 10;
        const string   actorId   = "actor-t7";
        const long     scopeId   = 600;
        const long     existingId = 33;
        const string   existingContent  = "I prefer PostgreSQL.";
        const string   candidateContent = "I prefer Redis for caching.";
        var            existingVec      = new float[] { 1.0f, 0.0f, 0.0f };
        var            candidateVec     = new float[] { 0.92f, 0.08f, 0.0f }; // similar but different

        SetupScopeCreation(projectId, actorId, scopeId);
        SetupExtract((candidateContent, "Preference"));

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = existingId, Content = existingContent, MemoryType = "Preference",
                        Model = "mistral-embed", Dimensions = 3, Embedding = existingVec }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);

        // Evaluator says different knowledge
        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ReturnsAsync(new ConsolidationEvaluationResult
            {
                IsSameKnowledge = false,
                Reason = "PostgreSQL and Redis serve different purposes."
            });

        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeId)).ReturnsAsync(50);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(50, "mistral-embed", candidateVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actorId, ("user", candidateContent));

        // Act
        var result = await service.IngestAsync(request, userId, projectId);

        // Assert — candidate is added as a new memory since it's different knowledge
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.Add, result.Memories[0].Action);
        Assert.Equal(50, result.Memories[0].MemoryId);
        Assert.Equal(candidateContent, result.Memories[0].Content);
    }

    // ── Test 8: Actor isolation — scope uses authenticated projectId ──────────

    [Fact]
    public async Task Test8_ActorIsolation_ScopeUsesAuthenticatedProjectId()
    {
        // Arrange
        var service    = CreateService();
        const long     userId    = 1;
        const long     projectA  = 10;
        const long     projectB  = 99;   // different project — must NOT be used
        const string   actorId   = "shared-actor";
        const long     scopeIdA  = 700;
        const string   content   = "Actor A memory.";

        // Only projectA is set up for scope creation
        _scopeResMock
            .Setup(s => s.GetOrCreateScopeAsync(projectA, actorId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(scopeIdA);

        SetupExtract((content, "Fact"));
        SetupNoExistingMemories(userId, scopeIdA);
        SetupNotExactDuplicate(userId, content, scopeIdA);
        SetupEmbedding(content, new float[] { 1.0f, 0.0f, 0.0f });
        SetupCreateMemory(userId, scopeIdA, 88);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(88, "mistral-embed", It.IsAny<float[]>())).Returns(Task.CompletedTask);

        var request = BuildRequest(actorId, ("user", content));

        // Act
        await service.IngestAsync(request, userId, projectA);

        // Assert: scope was resolved only for projectA
        _scopeResMock.Verify(s =>
            s.GetOrCreateScopeAsync(projectA, actorId, It.IsAny<CancellationToken>()),
            Times.Once);

        // projectB scope was never touched
        _scopeResMock.Verify(s =>
            s.GetOrCreateScopeAsync(projectB, It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);

        // Memory persisted with correct scopeId
        _memoryRepoMock.Verify(r =>
            r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeIdA),
            Times.Once);
    }

    // ── Test 9: Project isolation — scopeId comes from API-key project ────────

    [Fact]
    public async Task Test9_ProjectIsolation_ScopeIdBoundToAuthenticatedProject()
    {
        // Arrange
        var service      = CreateService();
        const long userId    = 5;
        const long projectA  = 20;
        const long scopeIdA  = 800;
        const string actorId = "actor-9";
        const string content  = "Project A secret memory.";

        SetupScopeCreation(projectA, actorId, scopeIdA);
        SetupExtract((content, "Fact"));
        SetupNoExistingMemories(userId, scopeIdA);
        SetupNotExactDuplicate(userId, content, scopeIdA);
        SetupEmbedding(content, new float[] { 0.5f, 0.5f, 0.0f });
        SetupCreateMemory(userId, scopeIdA, 101);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(101, "mistral-embed", It.IsAny<float[]>())).Returns(Task.CompletedTask);

        // Act
        var result = await service.IngestAsync(
            BuildRequest(actorId, ("user", content)), userId, projectA);

        // Assert: memory was created within the correct scope
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.Add, result.Memories[0].Action);
        _memoryRepoMock.Verify(r =>
            r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeIdA),
            Times.Once);
    }

    // ── Test 10: Extraction failure — safe failure, nothing persisted ─────────

    [Fact]
    public async Task Test10_ExtractionFailure_ThrowsNoPersistence()
    {
        // Arrange
        var service = CreateService();

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ThrowsAsync(new HttpRequestException("Mistral unavailable"));

        var request = BuildRequest("actor-t10", ("user", "I prefer PostgreSQL."));

        // Act + Assert
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.IngestAsync(request, userId: 1, projectId: 10));

        // Nothing persisted
        _memoryRepoMock.Verify(r =>
            r.CreateAsync(It.IsAny<long>(), It.IsAny<ExtractedMemory>(), It.IsAny<long?>(), It.IsAny<long?>()),
            Times.Never);
    }

    // ── Test 11: Consolidation evaluator failure → falls back to Add ──────────

    [Fact]
    public async Task Test11_ConsolidationFailure_FallsBackToAdd()
    {
        // Arrange
        var service    = CreateService();
        const long     userId    = 1;
        const long     projectId = 10;
        const string   actorId   = "actor-t11";
        const long     scopeId   = 900;
        const long     existingId = 22;
        const string   existingContent  = "I prefer PostgreSQL.";
        const string   candidateContent = "PostgreSQL is my database of choice.";
        var            existingVec      = new float[] { 1.0f, 0.0f, 0.0f };
        var            candidateVec     = new float[] { 0.96f, 0.04f, 0.0f };

        SetupScopeCreation(projectId, actorId, scopeId);
        SetupExtract((candidateContent, "Preference"));

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>
            {
                new() { MemoryId = existingId, Content = existingContent, MemoryType = "Preference",
                        Model = "mistral-embed", Dimensions = 3, Embedding = existingVec }
            });

        _memoryRepoMock.Setup(r => r.ExistsAsync(userId, candidateContent, scopeId)).ReturnsAsync(false);
        _embeddingGenMock.Setup(e => e.GenerateAsync(candidateContent)).ReturnsAsync(candidateVec);

        // Evaluator throws
        _evaluatorMock
            .Setup(ev => ev.EvaluateAsync(It.IsAny<MemoryConsolidationCandidate>()))
            .ThrowsAsync(new HttpRequestException("Mistral timeout"));

        // Fallback Add setup
        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeId)).ReturnsAsync(60);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(60, "mistral-embed", candidateVec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actorId, ("user", candidateContent));

        // Act
        var result = await service.IngestAsync(request, userId, projectId);

        // Assert: fallback to Add — existing memory not corrupted
        Assert.Single(result.Memories);
        Assert.Equal(IngestionOperation.Add, result.Memories[0].Action);

        // Existing memory never modified
        _memoryRepoMock.Verify(r => r.CreateMemoryVersionAsync(existingId, It.IsAny<string>(), It.IsAny<string>()), Times.Never);
        _memoryRepoMock.Verify(r => r.UpdateMemoryContentAsync(existingId, It.IsAny<string>()), Times.Never);
    }

    // ── Test 12: Validation — missing actorId in request ─────────────────────

    [Fact]
    public async Task Test12_Validation_EmptyActorId_ScopeCreationThrows()
    {
        // Arrange
        var service = CreateService();

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = "Something.", MemoryType = "Fact" }
            });

        // Scope resolution throws ArgumentException for empty actorId
        _scopeResMock
            .Setup(s => s.GetOrCreateScopeAsync(It.IsAny<long>(), string.Empty, It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ArgumentException("ActorId must not be null, empty, or whitespace."));

        _scopeResMock
            .Setup(s => s.GetOrCreateScopeAsync(It.IsAny<long>(), "   ", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new ArgumentException("ActorId must not be null, empty, or whitespace."));

        // Act + Assert — validation is expected to propagate
        await Assert.ThrowsAsync<ArgumentException>(() =>
            service.IngestAsync(
                new IngestConversationRequest
                {
                    ActorId  = "   ",
                    Messages = new List<IngestMessageItem>
                    {
                        new() { Role = "user", Content = "Something." }
                    }
                },
                userId: 1, projectId: 10));
    }

    // ── Test 13: Scope NOT created when extractor returns zero candidates ──────

    [Fact]
    public async Task Test13_ZeroCandidates_ScopeNeverCreated()
    {
        // Arrange
        var service = CreateService();

        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>());

        var request = BuildRequest("actor-t13", ("user", "Hello there."));

        // Act
        var result = await service.IngestAsync(request, userId: 1, projectId: 10);

        // Assert
        Assert.True(result.Processed);
        Assert.Equal(0, result.ExtractedCount);
        Assert.Empty(result.Memories);

        // Scope must NOT be created for a search-like empty result
        _scopeResMock.Verify(s =>
            s.GetOrCreateScopeAsync(It.IsAny<long>(), It.IsAny<string>(), It.IsAny<CancellationToken>()),
            Times.Never);
    }

    // ── Test 14: Working-set dedup — two identical candidates in one ingest ───

    [Fact]
    public async Task Test14_WithinBatchDedup_SecondIdenticalCandidateIsNoAction()
    {
        // Arrange
        var service    = CreateService();
        const long     userId    = 1;
        const long     projectId = 10;
        const string   actorId   = "actor-t14";
        const long     scopeId   = 1100;
        const string   content   = "I prefer PostgreSQL.";
        var            vec       = new float[] { 1.0f, 0.0f, 0.0f };

        SetupScopeCreation(projectId, actorId, scopeId);

        // Extractor returns the same memory twice
        _extractorMock
            .Setup(e => e.ExtractAsync(It.IsAny<IEnumerable<CreateMessageRequest>>()))
            .ReturnsAsync(new List<ExtractedMemory>
            {
                new() { Content = content, MemoryType = "Preference" },
                new() { Content = content, MemoryType = "Preference" }
            });

        _memoryRepoMock
            .Setup(r => r.GetActiveMemoryEmbeddingsAsync(userId, scopeId))
            .ReturnsAsync(new List<MemoryEmbeddingData>());

        // First call: not a duplicate; second call after creation: will be caught by ExistsAsync
        // but more realistically by the working-set in-memory similarity.
        // We simulate: first ExistsAsync false, second ExistsAsync true (repo was updated by Add).
        var callCount = 0;
        _memoryRepoMock
            .Setup(r => r.ExistsAsync(userId, content, scopeId))
            .ReturnsAsync(() => callCount++ > 0);

        _embeddingGenMock.Setup(e => e.GenerateAsync(content)).ReturnsAsync(vec);
        _memoryRepoMock.Setup(r => r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeId)).ReturnsAsync(111);
        _memoryRepoMock.Setup(r => r.SaveEmbeddingAsync(111, "mistral-embed", vec)).Returns(Task.CompletedTask);

        var request = BuildRequest(actorId, ("user", content + " " + content));

        // Act
        var result = await service.IngestAsync(request, userId, projectId);

        // Assert: first Add, second NoAction
        Assert.Equal(2, result.Memories.Count);
        Assert.Equal(IngestionOperation.Add,      result.Memories[0].Action);
        Assert.Equal(IngestionOperation.NoAction, result.Memories[1].Action);

        // Only one persist call
        _memoryRepoMock.Verify(r =>
            r.CreateAsync(userId, It.IsAny<ExtractedMemory>(), null, scopeId),
            Times.Once);
    }
}
