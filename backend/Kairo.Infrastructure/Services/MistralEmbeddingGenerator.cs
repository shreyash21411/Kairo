using System;
using System.Net.Http;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Infrastructure.Providers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

/// <summary>
/// Phase 4B: Adapter implementing IEmbeddingGenerator and IEmbeddingMetadataProvider.
/// Delegates raw vector generation to the underlying IEmbeddingProvider.
/// Preserves backward compatibility with legacy HttpClient/Options constructor and existing callers.
/// </summary>
public class MistralEmbeddingGenerator : IEmbeddingGenerator, IEmbeddingMetadataProvider
{
    private readonly IEmbeddingProvider _provider;

    public string ModelName => _provider.ModelName;
    public int ExpectedDimensions => _provider.ExpectedDimensions;

    /// <summary>
    /// Modern constructor resolving IEmbeddingProvider via DI.
    /// </summary>
    [ActivatorUtilitiesConstructor]
    public MistralEmbeddingGenerator(IEmbeddingProvider provider)
    {
        _provider = provider ?? throw new ArgumentNullException(nameof(provider));
    }

    /// <summary>
    /// Backward-compatible constructor for existing callers and legacy test fixtures.
    /// Internal so the standard DI container sees only one public constructor and avoids
    /// ambiguity. External callers that previously instantiated directly should use the
    /// DI-managed constructor via IEmbeddingProvider.
    /// </summary>
    internal MistralEmbeddingGenerator(
        HttpClient httpClient,
        IOptions<MistralEmbeddingOptions> options)
        : this(new MistralEmbeddingProvider(httpClient, options))
    {
    }

    /// <inheritdoc />
    public Task<float[]> GenerateAsync(string text)
    {
        return _provider.GenerateEmbeddingAsync(text);
    }
}