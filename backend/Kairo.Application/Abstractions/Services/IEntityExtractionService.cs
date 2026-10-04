using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Phase 1: Extracts named entities from memory content using an LLM.
/// </summary>
public interface IEntityExtractionService
{
    /// <summary>
    /// Extracts named entities from a block of text (typically a memory's content).
    /// Returns an empty list if no entities are found or if extraction is unavailable.
    /// This method must NEVER throw on extraction failure — it should log and return empty.
    /// </summary>
    /// <param name="text">The text to extract entities from.</param>
    /// <param name="cancellationToken">Propagates cancellation.</param>
    Task<List<ExtractedEntity>> ExtractAsync(
        string text,
        CancellationToken cancellationToken = default);
}
