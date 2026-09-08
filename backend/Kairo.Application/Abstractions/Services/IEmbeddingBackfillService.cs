using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

public interface IEmbeddingBackfillService
{
    /// <summary>
    /// Generates and persists embeddings for every active memory belonging
    /// to <paramref name="userId"/> that does not yet have an embedding.
    /// Idempotent: memories that already have an embedding are skipped.
    /// </summary>
    Task<EmbeddingBackfillResult> BackfillAsync(long userId);
}
