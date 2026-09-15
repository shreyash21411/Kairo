using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

namespace Kairo.Application.Services;

public class FullConsolidationService : IFullConsolidationService
{
    private readonly IMemoryConsolidationService _candidateService;
    private readonly IMemoryConsolidationEvaluator _evaluator;
    private readonly IMemoryRepository _memoryRepository;

    public FullConsolidationService(
        IMemoryConsolidationService candidateService,
        IMemoryConsolidationEvaluator evaluator,
        IMemoryRepository memoryRepository)
    {
        _candidateService = candidateService;
        _evaluator = evaluator;
        _memoryRepository = memoryRepository;
    }

    public async Task<FullConsolidationResult> RunAsync(
        long userId,
        long? scopeId = null)
    {
        if (userId <= 0)
        {
            throw new ArgumentException(
                "Invalid userId.",
                nameof(userId));
        }

        // ── Step 1: Candidate detection ───────────────────────────────────────
        // Delegates entirely to the existing (unchanged) candidate service.
        // This produces pairs with similarity >= 0.85.
        // ScopeId is passed through so candidates are bounded to a single scope.

        var candidateResult =
            await _candidateService.ConsolidateAsync(
                new MemoryConsolidationRequest { UserId = userId, ScopeId = scopeId },
                scopeId);

        var result = new FullConsolidationResult
        {
            MemoriesAnalyzed = candidateResult.MemoriesAnalyzed,
            CandidatePairs = candidateResult.CandidatePairs
        };

        // ── Step 2 + 3: Mistral evaluation then safe canonical merge ──────────

        foreach (var candidate in candidateResult.Candidates)
        {
            var detail = new FullConsolidationDetail
            {
                MemoryIdA = candidate.MemoryIdA,
                MemoryIdB = candidate.MemoryIdB,
                Similarity = candidate.Similarity
            };

            // ── Step 2: Mistral evaluation ─────────────────────────────────
            ConsolidationEvaluationResult evaluation;

            try
            {
                evaluation = await _evaluator.EvaluateAsync(candidate);
                detail.WasEvaluated = true;
            }
            catch (Exception ex)
            {
                // Fail safe: skip this pair if the evaluator throws.
                detail.WasEvaluated = false;
                detail.WasConsolidated = false;
                detail.Reason =
                    $"Evaluator threw an exception: {ex.Message}";

                result.Details.Add(detail);
                continue;
            }

            result.EvaluatedPairs++;
            detail.Reason = evaluation.Reason;

            if (!evaluation.IsSameKnowledge)
            {
                // Mistral confirmed these are distinct memories — keep both.
                detail.WasConsolidated = false;
                result.Details.Add(detail);
                continue;
            }

            // ── Step 3: Safe canonical merge ───────────────────────────────
            // Convention: Memory A is canonical; Memory B becomes redundant.
            // Mistral provided canonical content; fall back to ContentA if null.

            var canonicalMemoryId = candidate.MemoryIdA;
            var redundantMemoryId = candidate.MemoryIdB;
            var canonicalContent = string.IsNullOrWhiteSpace(evaluation.CanonicalContent)
                ? candidate.ContentA
                : evaluation.CanonicalContent;

            // Read current state to support idempotency and versioning.
            var canonicalSnapshot =
                await _memoryRepository.GetMemorySnapshotAsync(canonicalMemoryId);

            var redundantSnapshot =
                await _memoryRepository.GetMemorySnapshotAsync(redundantMemoryId);

            if (canonicalSnapshot == null || redundantSnapshot == null)
            {
                detail.WasConsolidated = false;
                detail.Reason = "Could not load memory snapshots for merge.";
                result.Details.Add(detail);
                continue;
            }

            // Idempotency guard: if redundant was already deactivated, skip.
            if (!redundantSnapshot.IsActive)
            {
                detail.WasConsolidated = false;
                detail.Reason =
                    "Redundant memory is already inactive (idempotent skip).";
                result.Details.Add(detail);
                continue;
            }

            // Version + update canonical content if it changed.
            if (!string.Equals(
                canonicalSnapshot.Content,
                canonicalContent,
                StringComparison.Ordinal))
            {
                // Save the pre-change state as a version entry.
                await _memoryRepository.CreateMemoryVersionAsync(
                    canonicalMemoryId,
                    canonicalSnapshot.Content,
                    "ConsolidationUpdate");

                await _memoryRepository.UpdateMemoryContentAsync(
                    canonicalMemoryId,
                    canonicalContent);
            }

            // Version the redundant memory before deactivating.
            await _memoryRepository.CreateMemoryVersionAsync(
                redundantMemoryId,
                redundantSnapshot.Content,
                "ConsolidationDeactivated");

            // Deactivate the redundant memory (IsActive = false).
            // Never physically deletes.
            await _memoryRepository.DeactivateMemoryAsync(redundantMemoryId);

            result.ConsolidatedPairs++;
            result.DeactivatedMemories++;
            result.DeactivatedMemoryIds.Add(redundantMemoryId);

            detail.WasConsolidated = true;
            detail.CanonicalMemoryId = canonicalMemoryId;
            detail.DeactivatedMemoryId = redundantMemoryId;

            result.Details.Add(detail);
        }

        return result;
    }
}
