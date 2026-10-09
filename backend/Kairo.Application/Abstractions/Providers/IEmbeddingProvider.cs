using System.Threading;
using System.Threading.Tasks;

namespace Kairo.Application.Abstractions.Providers;

/// <summary>
/// Phase 4B: Low-level vector embedding provider contract.
/// Exposes model identity, expected dimensions, and embedding generation.
/// </summary>
public interface IEmbeddingProvider
{
    /// <summary>
    /// Identifier of the provider implementation (e.g. "Mistral").
    /// </summary>
    string ProviderName { get; }

    /// <summary>
    /// Identifier of the model in use (e.g. "mistral-embed").
    /// </summary>
    string ModelName { get; }

    /// <summary>
    /// Dimensionality of the vectors emitted by this provider model (e.g. 1024).
    /// </summary>
    int ExpectedDimensions { get; }

    /// <summary>
    /// Generates a normalized vector embedding for the supplied text.
    /// </summary>
    Task<float[]> GenerateEmbeddingAsync(
        string text,
        CancellationToken cancellationToken = default);
}
