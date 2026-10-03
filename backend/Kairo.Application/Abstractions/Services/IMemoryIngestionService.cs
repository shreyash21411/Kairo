using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Orchestrates the Phase 2 conversational memory ingestion pipeline.
///
/// Flow:
///   1. Validate request.
///   2. Extract candidate memories from the raw conversation using IMemoryExtractor.
///   3. For each candidate, determine if a semantically similar memory already exists.
///   4. If yes → run IMemoryConsolidationEvaluator to decide Merge or NoAction.
///   5. If no  → Add (persist via IMemoryService).
///   6. Merge  → update the existing memory with canonical content (versioned).
///
/// Authentication:
///   UserId and ProjectId come from the authenticated API key (IApiKeyContext).
///   The client supplies only ActorId.
///
/// Scope:
///   Ingestion may create the MemoryScope if the actor is first-time.
///   This differs from search, which must not create a scope.
/// </summary>
public interface IMemoryIngestionService
{
    /// <summary>
    /// Processes a raw conversation and persists any durable memories extracted from it.
    /// </summary>
    /// <param name="request">The validated ingestion request with actorId and messages.</param>
    /// <param name="userId">The authenticated user (from API key).</param>
    /// <param name="projectId">The authenticated project (from API key).</param>
    /// <param name="cancellationToken">Propagates cancellation.</param>
    Task<MemoryIngestionResponse> IngestAsync(
        IngestConversationRequest request,
        long userId,
        long projectId,
        CancellationToken cancellationToken = default);
}
