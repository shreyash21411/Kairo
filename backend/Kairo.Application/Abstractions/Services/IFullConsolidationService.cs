using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

public interface IFullConsolidationService
{
    /// <summary>
    /// Runs the full consolidation pipeline for <paramref name="userId"/>:
    /// 1. Candidate detection (cosine similarity ≥ 0.85)
    /// 2. Mistral evaluation for each candidate
    /// 3. Safe canonical merge + MemoryVersion for confirmed duplicates
    /// </summary>
    Task<FullConsolidationResult> RunAsync(long userId);
}
