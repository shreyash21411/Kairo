using System;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Phase 4B: Optional metadata interface implemented by embedding generators and adapters.
/// Exposes model identity and expected vector dimensionality without adding breaking members to IEmbeddingGenerator.
/// </summary>
public interface IEmbeddingMetadataProvider
{
    /// <summary>
    /// Identifier of the model in use (e.g. "mistral-embed").
    /// </summary>
    string ModelName { get; }

    /// <summary>
    /// Expected dimensional length of the generated embedding vectors (e.g. 1024).
    /// </summary>
    int ExpectedDimensions { get; }
}

/// <summary>
/// Helper extensions for safely querying embedding model metadata and evaluating vector space compatibility.
/// </summary>
public static class EmbeddingGeneratorExtensions
{
    public const string DefaultModelName = "mistral-embed";
    public const int DefaultDimensions = 1024;

    /// <summary>
    /// Returns the active model name, falling back to the default Mistral model if unassigned.
    /// </summary>
    public static string GetModelName(this IEmbeddingGenerator generator)
    {
        if (generator is IEmbeddingMetadataProvider metadata && !string.IsNullOrWhiteSpace(metadata.ModelName))
        {
            return metadata.ModelName;
        }

        return DefaultModelName;
    }

    /// <summary>
    /// Returns the expected vector dimensions if configured by an IEmbeddingMetadataProvider, or null for unconstrained mocks.
    /// </summary>
    public static int? GetExpectedDimensions(this IEmbeddingGenerator generator)
    {
        if (generator is IEmbeddingMetadataProvider metadata && metadata.ExpectedDimensions > 0)
        {
            return metadata.ExpectedDimensions;
        }

        return null;
    }

    /// <summary>
    /// Evaluates whether an existing persisted embedding vector's model is compatible with the active query/model space.
    /// Prevents cross-model cosine comparison while allowing null/unspecified model fields in legacy test mocks.
    /// </summary>
    public static bool IsModelCompatible(string? storedModel, string activeModel)
    {
        if (string.IsNullOrWhiteSpace(storedModel))
        {
            // Legacy test mock or unmigrated record with unpopulated model: compatible with default
            return true;
        }

        return string.Equals(storedModel.Trim(), activeModel.Trim(), StringComparison.OrdinalIgnoreCase);
    }
}
