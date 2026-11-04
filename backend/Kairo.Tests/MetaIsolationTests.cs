using System;
using System.Net.Http;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Infrastructure.Meta;
using Kairo.Infrastructure.Providers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Isolation tests confirming the architectural boundary between Meta AI and Mistral.
///
/// Key guarantees verified:
///   1. ILlmProvider resolves to MistralLlmProvider — never MetaAIClient.
///   2. MetaAIClient is NOT assignable to ILlmProvider.
///   3. IMetaAIClient resolves to MetaAIClient — not MistralLlmProvider.
///   4. IMetaMemoryService → MetaMemoryService.
///   5. IMetaContinuityService → MetaContinuityService.
///   6. MistralLlmProvider resolves independently with ProviderName == "Mistral".
///   7. MetaAIOptions.Enabled defaults to false.
///   8. MetaTokenUsage is the same type in both MetaMemoryResult and MetaContinuityResult.
/// </summary>
public class MetaIsolationTests
{
    // ── Shared DI setup helpers ────────────────────────────────────────────────

    /// <summary>Minimal Mistral-only DI setup (mirrors Program.cs Mistral block).</summary>
    private static ServiceCollection BuildMistralServices()
    {
        var services = new ServiceCollection();
        services.AddLogging();

        services.Configure<ProviderOptions>(opts =>
        {
            opts.DefaultLlmProvider       = "Mistral";
            opts.DefaultEmbeddingProvider = "Mistral";
        });
        services.Configure<MistralOptions>(opts =>
        {
            opts.ApiKey = "test-mistral-key";
            opts.Model  = "mistral-small-latest";
        });
        services.Configure<MistralEmbeddingOptions>(opts =>
        {
            opts.ApiKey = "test-mistral-key";
            opts.Model  = "mistral-embed";
        });

        services.AddHttpClient<MistralLlmProvider>();
        services.AddScoped<ILlmProvider>(sp => sp.GetRequiredService<MistralLlmProvider>());

        return services;
    }

    /// <summary>Full Meta DI setup (mirrors the Program.cs Meta block).</summary>
    private static ServiceCollection BuildMetaServices()
    {
        var services = new ServiceCollection();
        services.AddLogging();

        services.Configure<MetaAIOptions>(opts =>
        {
            opts.Enabled = false; // default
            opts.ApiKey  = string.Empty;
        });

        services.AddHttpClient<IMetaAIClient, MetaAIClient>();
        services.AddScoped<IMetaMemoryService, MetaMemoryService>();
        services.AddScoped<IMetaContinuityService, MetaContinuityService>();

        return services;
    }

    /// <summary>Combined DI setup — both Mistral and Meta registered.</summary>
    private static ServiceProvider BuildCombinedProvider()
    {
        var services = new ServiceCollection();
        services.AddLogging();

        // Mistral
        services.Configure<ProviderOptions>(opts =>
        {
            opts.DefaultLlmProvider       = "Mistral";
            opts.DefaultEmbeddingProvider = "Mistral";
        });
        services.Configure<MistralOptions>(opts =>
        {
            opts.ApiKey = "test-mistral-key";
            opts.Model  = "mistral-small-latest";
        });
        services.Configure<MistralEmbeddingOptions>(opts =>
        {
            opts.ApiKey = "test-mistral-key";
            opts.Model  = "mistral-embed";
        });
        services.AddHttpClient<MistralLlmProvider>();
        services.AddScoped<ILlmProvider>(sp => sp.GetRequiredService<MistralLlmProvider>());

        // Meta
        services.Configure<MetaAIOptions>(opts =>
        {
            opts.Enabled = false;
            opts.ApiKey  = string.Empty;
        });
        services.AddHttpClient<IMetaAIClient, MetaAIClient>();
        services.AddScoped<IMetaMemoryService, MetaMemoryService>();
        services.AddScoped<IMetaContinuityService, MetaContinuityService>();

        return services.BuildServiceProvider();
    }

    // ── Tests ──────────────────────────────────────────────────────────────────

    [Fact]
    public void ILlmProvider_ResolvesToMistralLlmProvider()
    {
        using var sp = BuildCombinedProvider();
        using var scope = sp.CreateScope();

        var provider = scope.ServiceProvider.GetRequiredService<ILlmProvider>();

        Assert.IsType<MistralLlmProvider>(provider);
        Assert.Equal("Mistral", provider.ProviderName);
    }

    [Fact]
    public void MetaAIClient_IsNotAssignableToILlmProvider()
    {
        // Type-level check — MetaAIClient must not implement ILlmProvider.
        Assert.False(typeof(ILlmProvider).IsAssignableFrom(typeof(MetaAIClient)));
    }

    [Fact]
    public void IMetaAIClient_ResolvesToMetaAIClient_NotMistralLlmProvider()
    {
        using var sp = BuildCombinedProvider();
        using var scope = sp.CreateScope();

        var client = scope.ServiceProvider.GetRequiredService<IMetaAIClient>();

        Assert.IsType<MetaAIClient>(client);
        Assert.IsNotType<MistralLlmProvider>(client);
    }

    [Fact]
    public void IMetaMemoryService_ResolvesToMetaMemoryService()
    {
        using var sp = BuildCombinedProvider();
        using var scope = sp.CreateScope();

        var service = scope.ServiceProvider.GetRequiredService<IMetaMemoryService>();

        Assert.IsType<MetaMemoryService>(service);
    }

    [Fact]
    public void IMetaContinuityService_ResolvesToMetaContinuityService()
    {
        using var sp = BuildCombinedProvider();
        using var scope = sp.CreateScope();

        var service = scope.ServiceProvider.GetRequiredService<IMetaContinuityService>();

        Assert.IsType<MetaContinuityService>(service);
    }

    [Fact]
    public void MistralLlmProvider_ResolvesIndependently_WithCorrectProviderName()
    {
        using var sp = BuildCombinedProvider();
        using var scope = sp.CreateScope();

        // MistralLlmProvider itself can be resolved (it is the concrete backing class).
        var mistral = scope.ServiceProvider.GetRequiredService<MistralLlmProvider>();

        Assert.NotNull(mistral);
        Assert.Equal("Mistral", mistral.ProviderName);
    }

    [Fact]
    public void MetaAIOptions_EnabledDefaultsToFalse()
    {
        // Verify the class default — not relying on any configuration binding.
        var opts = new MetaAIOptions();
        Assert.False(opts.Enabled);
    }

    [Fact]
    public void MetaTokenUsage_IsSameTypeInBothResultDTOs()
    {
        // Compile-time and runtime proof that MetaTokenUsage is not duplicated.
        var memoryUsage     = new Application.DTOs.MetaMemoryResult().TokenUsage;
        var continuityUsage = new Application.DTOs.MetaContinuityResult().TokenUsage;

        Assert.IsType<MetaTokenUsage>(memoryUsage);
        Assert.IsType<MetaTokenUsage>(continuityUsage);
        Assert.Equal(memoryUsage.GetType(), continuityUsage.GetType());
    }
}
