using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Kairo.Application.Services;
using Kairo.Application.DTOs;



namespace Kairo.API.Controllers;

/// <summary>
/// Chat processing and diagnostic endpoints — application/agent authenticated boundary.
///
/// Authentication: KairoApiKey (default scheme).
/// Where a UserId is required, it is always resolved from IApiKeyContext.
/// Callers cannot supply or override their UserId.
/// </summary>
[ApiController]
[Route("api/chat-processing")]
[Authorize]
public class ChatProcessingController : ControllerBase
{
    private readonly IChatProcessingService _chatProcessingService;
    private readonly IEmbeddingGenerator _embeddingGenerator;
    private readonly SemanticSimilarityService _similarityService;
    private readonly MemoryRetrievalService _memoryRetrievalService;
    private readonly IMemoryConsolidationService _memoryConsolidationService;
    private readonly IEmbeddingBackfillService _embeddingBackfillService;
    private readonly IFullConsolidationService _fullConsolidationService;
    private readonly IApiKeyContext _apiKeyContext;

    public ChatProcessingController(
        IChatProcessingService chatProcessingService,
        IEmbeddingGenerator embeddingGenerator,
        SemanticSimilarityService similarityService,
        MemoryRetrievalService memoryRetrievalService,
        IMemoryConsolidationService memoryConsolidationService,
        IEmbeddingBackfillService embeddingBackfillService,
        IFullConsolidationService fullConsolidationService,
        IApiKeyContext apiKeyContext)
    {
        _chatProcessingService = chatProcessingService;
        _embeddingGenerator = embeddingGenerator;
        _similarityService = similarityService;
        _memoryRetrievalService = memoryRetrievalService;
        _memoryConsolidationService = memoryConsolidationService;
        _embeddingBackfillService = embeddingBackfillService;
        _fullConsolidationService = fullConsolidationService;
        _apiKeyContext = apiKeyContext;
    }

    [HttpPost("{chatId:long}")]
    public async Task<IActionResult> ProcessChat(long chatId)
    {
        if (chatId <= 0)
        {
            return BadRequest(new
            {
                message = "Invalid chatId."
            });
        }

        var processed =
            await _chatProcessingService.ProcessChatAsync(chatId);

        if (!processed)
        {
            return BadRequest(new
            {
                message = "Chat processing failed."
            });
        }

        return Ok(new
        {
            chatId,
            message = "Chat processed successfully."
        });
    }

    public class TestEmbeddingRequest
    {
        public string Text { get; set; } = null!;
    }

    [HttpPost("test-embedding")]
    public async Task<IActionResult> TestEmbedding(
        [FromBody] TestEmbeddingRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Text))
        {
            return BadRequest(new
            {
                message = "Text cannot be empty."
            });
        }

        var embedding =
            await _embeddingGenerator.GenerateAsync(request.Text);

        return Ok(new
        {
            dimensions = embedding.Length,
            embedding
        });
    }

    public class TestSimilarityRequest
    {
        public string TextA { get; set; } = null!;

        public string TextB { get; set; } = null!;
    }

    [HttpPost("test-similarity")]
    public async Task<IActionResult> TestSimilarity(
        [FromBody] TestSimilarityRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.TextA) ||
            string.IsNullOrWhiteSpace(request.TextB))
        {
            return BadRequest(new
            {
                message = "Both TextA and TextB are required."
            });
        }

        var embeddingA =
            await _embeddingGenerator.GenerateAsync(
                request.TextA);

        var embeddingB =
            await _embeddingGenerator.GenerateAsync(
                request.TextB);

        var similarity =
            _similarityService.CalculateCosineSimilarity(
                embeddingA,
                embeddingB);

        return Ok(new
        {
            similarity,
            dimensionsA = embeddingA.Length,
            dimensionsB = embeddingB.Length
        });
    }

    /// <summary>
    /// Tests memory retrieval scoped to the authenticated user.
    /// UserId is resolved from the API key — callers cannot supply their own.
    /// </summary>
    [HttpPost("test-retrieval")]
    public async Task<IActionResult> TestRetrieval(
        [FromBody] MemoryRetrievalRequest request)
    {
        // UserId is always derived from the authenticated API key context.
        var userId = _apiKeyContext.UserId;

        if (string.IsNullOrWhiteSpace(request.Query))
        {
            return BadRequest(new
            {
                message = "Query cannot be empty."
            });
        }

        if (request.TopK <= 0)
        {
            return BadRequest(new
            {
                message = "TopK must be greater than zero."
            });
        }

        var memories =
            await _memoryRetrievalService.RetrieveAsync(
                userId,
                request.Query,
                request.TopK);

        if (memories.Count == 0)
        {
            return Ok(new
            {
                query = request.Query,
                count = 0,
                memories,
                message = "No relevant memory found for this question."
            });
        }

        return Ok(new
        {
            query = request.Query,
            count = memories.Count,
            memories
        });
    }

    /// <summary>
    /// Tests the working-set deduplication pipeline for the authenticated user.
    /// The UserId in the request body is ignored; it is overridden from the API key context.
    /// </summary>
    [HttpPost("test-working-set")]
    public async Task<IActionResult> TestWorkingSet(
        [FromBody] WorkingSetTestRequest request)
    {
        // Override any caller-supplied UserId with the authenticated identity.
        request.UserId = _apiKeyContext.UserId;

        try
        {
            var result =
                await _chatProcessingService
                    .TestWorkingSetDedupAsync(request);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
    }

    /// <summary>
    /// Tests consolidation candidate detection for the authenticated user.
    /// The UserId in the request body is ignored; it is overridden from the API key context.
    /// </summary>
    [HttpPost("test-consolidation-candidates")]
    public async Task<IActionResult> TestConsolidationCandidates(
        [FromBody] MemoryConsolidationRequest request)
    {
        // Override any caller-supplied UserId with the authenticated identity.
        request.UserId = _apiKeyContext.UserId;

        try
        {
            var result =
                await _memoryConsolidationService
                    .ConsolidateAsync(request);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
    }

    // ── Task 1: Embedding backfill ───────────────────────────────────────────────

    /// <summary>
    /// Backfills embeddings for all active memories of the authenticated user
    /// that do not yet have an embedding.
    /// UserId is resolved from the API key — callers cannot supply their own.
    /// </summary>
    [HttpPost("test-embedding-backfill")]
    public async Task<IActionResult> TestEmbeddingBackfill()
    {
        // UserId is always derived from the authenticated API key context.
        var userId = _apiKeyContext.UserId;

        try
        {
            var result =
                await _embeddingBackfillService.BackfillAsync(userId);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
    }

    // ── Task 4: Full consolidation pipeline (candidates → Mistral → merge) ──

    /// <summary>
    /// Runs the full consolidation pipeline for the authenticated user.
    /// UserId is resolved from the API key — callers cannot supply their own.
    /// </summary>
    [HttpPost("test-full-consolidation")]
    public async Task<IActionResult> TestFullConsolidation()
    {
        // UserId is always derived from the authenticated API key context.
        var userId = _apiKeyContext.UserId;

        try
        {
            var result =
                await _fullConsolidationService.RunAsync(userId);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
    }
}