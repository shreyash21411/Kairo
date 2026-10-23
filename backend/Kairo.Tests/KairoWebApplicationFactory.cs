using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Kairo.Tests;

// ─────────────────────────────────────────────────────────────────────────────
//  Deterministic fake providers — no external HTTP calls, fully reproducible
// ─────────────────────────────────────────────────────────────────────────────

internal sealed class FakeLlmProvider : ILlmProvider
{
    public string ProviderName => "Fake";
    public string DefaultModel => "fake-llm";

    public Task<string> GenerateChatCompletionAsync(
        LlmCompletionRequest request, CancellationToken cancellationToken = default)
    {
        // Return structurally valid JSON that extraction services can parse.
        var json = request.EnforceJsonOutput
            ? """[{"content":"Extracted memory","type":"Fact","relevance_score":0.9}]"""
            : "Extracted memory content";
        return Task.FromResult(json);
    }
}

internal sealed class FakeEmbeddingProvider : IEmbeddingProvider
{
    public string ProviderName    => "Fake";
    public string ModelName       => "mistral-embed";
    public int ExpectedDimensions => 4;

    public Task<float[]> GenerateEmbeddingAsync(
        string text, CancellationToken cancellationToken = default)
    {
        // Stable, normalised 4-D vector derived from the text hash.
        int hash = 0;
        foreach (char c in text) hash = hash * 31 + c;
        float a  = ((hash & 0xFF)         / 255f) * 2f - 1f;
        float b  = (((hash >> 8)  & 0xFF) / 255f) * 2f - 1f;
        float c2 = (((hash >> 16) & 0xFF) / 255f) * 2f - 1f;
        float d  = (((hash >> 24) & 0xFF) / 255f) * 2f - 1f;
        float mag = MathF.Sqrt(a * a + b * b + c2 * c2 + d * d);
        if (mag < 1e-6f) mag = 1f;
        return Task.FromResult(new float[] { a / mag, b / mag, c2 / mag, d / mag });
    }
}

internal sealed class FakeEmbeddingGenerator : IEmbeddingGenerator, IEmbeddingMetadataProvider
{
    private readonly FakeEmbeddingProvider _p = new();
    public string ModelName       => _p.ModelName;
    public int ExpectedDimensions => _p.ExpectedDimensions;
    public Task<float[]> GenerateAsync(string text, CancellationToken ct = default)
        => _p.GenerateEmbeddingAsync(text, ct);
}

internal sealed class FakeRerankProvider : IRerankProvider
{
    public string ProviderName => "Fake";
    public string DefaultModel => "fake-rerank";

    public Task<RerankResponse> RerankAsync(
        RerankRequest request, CancellationToken ct = default)
    {
        var scores = new List<RerankCandidateScore>();
        for (int i = 0; i < request.Candidates.Count; i++)
            scores.Add(new RerankCandidateScore
            {
                MemoryId       = request.Candidates[i].MemoryId,
                RelevanceScore = Math.Max(0.0, 1.0 - i * 0.1)
            });
        return Task.FromResult(new RerankResponse { ScoredCandidates = scores });
    }
}

// Matches: Task<List<ExtractedMemory>> ExtractAsync(IEnumerable<CreateMessageRequest> messages)
internal sealed class FakeMemoryExtractor : IMemoryExtractor
{
    public Task<List<ExtractedMemory>> ExtractAsync(
        IEnumerable<CreateMessageRequest> messages)
        => Task.FromResult(new List<ExtractedMemory>
        {
            new() { Content = "Extracted memory", MemoryType = "Fact" }
        });
}

// Matches: Task<List<RetrievedMemory>> EvaluateAsync(string query, List<RetrievedMemory> candidates)
internal sealed class FakeMemoryRelevanceEvaluator : IMemoryRelevanceEvaluator
{
    public Task<List<RetrievedMemory>> EvaluateAsync(
        string query, List<RetrievedMemory> candidates)
        => Task.FromResult(candidates);
}

// Matches: Task<ConsolidationEvaluationResult> EvaluateAsync(MemoryConsolidationCandidate candidate)
internal sealed class FakeMemoryConsolidationEvaluator : IMemoryConsolidationEvaluator
{
    public Task<ConsolidationEvaluationResult> EvaluateAsync(
        MemoryConsolidationCandidate candidate)
        => Task.FromResult(new ConsolidationEvaluationResult { Action = ConsolidationAction.Add });
}

// Matches: Task<List<ExtractedEntity>> ExtractAsync(string text, CancellationToken cancellationToken = default)
internal sealed class FakeEntityExtractionService : IEntityExtractionService
{
    public Task<List<ExtractedEntity>> ExtractAsync(
        string text, CancellationToken cancellationToken = default)
        => Task.FromResult(new List<ExtractedEntity>());
}

// ─────────────────────────────────────────────────────────────────────────────
//  WebApplicationFactory
// ─────────────────────────────────────────────────────────────────────────────

/// <summary>
/// Boots the real Kairo.API ASP.NET Core pipeline for live HTTP E2E tests.
///
/// Safety guarantees:
/// - Points exclusively at kairo_fresh_init_test. Throws if credentials cannot be discovered.
/// - All AI provider interfaces replaced with deterministic fakes. No Mistral HTTP calls.
/// - Placeholder API key strings satisfy ProviderConfigurationValidator without modifying production code.
/// - kairo_dev is never touched.
/// </summary>
public sealed class KairoWebApplicationFactory : WebApplicationFactory<Program>
{
    public const string TestDbName = "kairo_fresh_init_test";

    static KairoWebApplicationFactory()
    {
        var connStr = ResolveTestConnectionString();
        Environment.SetEnvironmentVariable("ConnectionStrings__KairoPostgres", connStr);
        Environment.SetEnvironmentVariable("Providers__DatabaseProvider", "PostgreSQL");
        Environment.SetEnvironmentVariable("Mistral__ApiKey", "test-e2e-placeholder-not-real");
        Environment.SetEnvironmentVariable("MistralEmbedding__ApiKey", "test-e2e-placeholder-not-real");
        Environment.SetEnvironmentVariable("Mistral__Model", "mistral-small-latest");
        Environment.SetEnvironmentVariable("MistralEmbedding__Model", "mistral-embed");
        Environment.SetEnvironmentVariable("Providers__DefaultLlmProvider", "Mistral");
        Environment.SetEnvironmentVariable("Providers__DefaultEmbeddingProvider", "Mistral");
        Environment.SetEnvironmentVariable("Kairo__Jwt__SigningKey", "kairo-e2e-test-signing-key-32chars!");
        Environment.SetEnvironmentVariable("Reranker__Enabled", "true");
        Environment.SetEnvironmentVariable("Quota__FailOpen", "true");
    }

    /// <summary>
    /// Resolves the connection string for kairo_fresh_init_test using the same
    /// credential-discovery pattern as Phase4CVectorRetrievalIntegrationTests.
    /// </summary>
    public static string ResolveTestConnectionString()
    {
        var host    = Environment.GetEnvironmentVariable("POSTGRES_HOST")      ?? "127.0.0.1";
        var portStr = Environment.GetEnvironmentVariable("POSTGRES_HOST_PORT") ?? "5433";
        int.TryParse(portStr, out var port);
        if (port == 0) port = 5433;
        var user    = Environment.GetEnvironmentVariable("KAIRO_APP_USER")     ?? "kairo_dev";

        var envPass = Environment.GetEnvironmentVariable("KAIRO_APP_PASSWORD");
        if (!string.IsNullOrWhiteSpace(envPass))
            return $"Host={host};Port={port};Database={TestDbName};Username={user};Password={envPass};";

        var dir = new DirectoryInfo(AppDomain.CurrentDomain.BaseDirectory);
        while (dir != null && !File.Exists(Path.Combine(dir.FullName, "infrastructure", "docker", ".env")))
            dir = dir.Parent;

        if (dir != null)
        {
            string? dUser = null, dPass = null, dPort = null;
            foreach (var rawLine in File.ReadAllLines(Path.Combine(dir.FullName, "infrastructure", "docker", ".env")))
            {
                var line = rawLine.Trim();
                if (line.StartsWith('#') || !line.Contains('=')) continue;
                var parts = line.Split('=', 2);
                if (parts[0].Trim() == "KAIRO_APP_USER")     dUser = parts[1].Trim();
                if (parts[0].Trim() == "KAIRO_APP_PASSWORD") dPass = parts[1].Trim();
                if (parts[0].Trim() == "POSTGRES_HOST_PORT") dPort = parts[1].Trim();
            }
            if (!string.IsNullOrWhiteSpace(dPass))
            {
                if (!string.IsNullOrWhiteSpace(dUser)) user = dUser;
                if (int.TryParse(dPort, out var p) && p > 0) port = p;
                return $"Host={host};Port={port};Database={TestDbName};Username={user};Password={dPass};";
            }
        }

        throw new InvalidOperationException(
            $"Cannot resolve PostgreSQL credentials for {TestDbName}. " +
            "Set KAIRO_APP_PASSWORD or ensure infrastructure/docker/.env exists.");
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // ── 1. Inject test-only configuration ────────────────────────────────
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                // Real test database — NEVER kairo_dev
                ["ConnectionStrings:KairoPostgres"]   = ResolveTestConnectionString(),
                ["Providers:DatabaseProvider"]         = "PostgreSQL",

                // Placeholder keys to satisfy ProviderConfigurationValidator.
                // Never sent to Mistral — providers are overridden below.
                ["Mistral:ApiKey"]                     = "test-e2e-placeholder-not-real",
                ["MistralEmbedding:ApiKey"]            = "test-e2e-placeholder-not-real",
                ["Mistral:Model"]                      = "mistral-small-latest",
                ["MistralEmbedding:Model"]             = "mistral-embed",
                ["Providers:DefaultLlmProvider"]       = "Mistral",
                ["Providers:DefaultEmbeddingProvider"] = "Mistral",

                // Deterministic JWT signing key for tests (>=32 chars)
                ["Kairo:Jwt:SigningKey"]               = "kairo-e2e-test-signing-key-32chars!",

                // Misc
                ["Kairo:Cors:AllowedOrigins:0"]        = "http://localhost:3000",
                ["Reranker:Enabled"]                   = "true",
                ["Quota:FailOpen"]                     = "true",
                ["ForwardedHeaders:ForwardLimit"]      = "1",
                ["ForwardedHeaders:TrustAllNetworks"]  = "false",
            });
        });

        // ── 2. Replace external AI providers with deterministic fakes ─────────
        builder.ConfigureTestServices(services =>
        {
            services.RemoveAll<ILlmProvider>();
            services.RemoveAll<IEmbeddingProvider>();
            services.RemoveAll<IRerankProvider>();
            services.RemoveAll<IEmbeddingGenerator>();
            services.RemoveAll<IMemoryExtractor>();
            services.RemoveAll<IMemoryRelevanceEvaluator>();
            services.RemoveAll<IMemoryConsolidationEvaluator>();
            services.RemoveAll<IEntityExtractionService>();

            services.AddSingleton<ILlmProvider,       FakeLlmProvider>();
            services.AddSingleton<IEmbeddingProvider, FakeEmbeddingProvider>();
            services.AddSingleton<IRerankProvider,    FakeRerankProvider>();

            services.AddSingleton<FakeEmbeddingGenerator>();
            services.AddSingleton<IEmbeddingGenerator>(
                sp => sp.GetRequiredService<FakeEmbeddingGenerator>());

            services.AddScoped<IMemoryExtractor>(
                _ => new FakeMemoryExtractor());
            services.AddScoped<IMemoryRelevanceEvaluator>(
                _ => new FakeMemoryRelevanceEvaluator());
            services.AddScoped<IMemoryConsolidationEvaluator>(
                _ => new FakeMemoryConsolidationEvaluator());
            services.AddScoped<IEntityExtractionService>(
                _ => new FakeEntityExtractionService());
        });

        builder.UseEnvironment("Test");
    }
}
