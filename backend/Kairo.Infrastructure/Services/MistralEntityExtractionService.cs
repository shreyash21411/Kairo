using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Providers;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Providers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

/// <summary>
/// Phase 1 & 4B: Mistral-backed entity extraction service.
/// Extracts named entities and relationships from memory content text.
/// Delegates raw chat completion transport to ILlmProvider while retaining all prompt engineering and entity normalization.
/// Never throws on extraction failure — returns empty list.
/// </summary>
public class MistralEntityExtractionService : IEntityExtractionService
{
    private readonly ILlmProvider _llmProvider;
    private readonly ILogger<MistralEntityExtractionService> _logger;

    private static readonly HashSet<string> ValidEntityTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "PERSON", "ORGANIZATION", "PRODUCT", "TECHNOLOGY",
        "LOCATION", "PROJECT", "COMPANY", "TOOL", "CONCEPT"
    };

    /// <summary>
    /// Modern constructor resolving ILlmProvider via DI.
    /// </summary>
    [ActivatorUtilitiesConstructor]
    public MistralEntityExtractionService(
        ILlmProvider llmProvider,
        ILogger<MistralEntityExtractionService> logger)
    {
        _llmProvider = llmProvider ?? throw new ArgumentNullException(nameof(llmProvider));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <summary>
    /// Backward-compatible constructor for existing callers and legacy test fixtures.
    /// </summary>
    public MistralEntityExtractionService(
        HttpClient httpClient,
        IOptions<MistralOptions> options,
        ILogger<MistralEntityExtractionService> logger)
        : this(new MistralLlmProvider(httpClient, options), logger)
    {
    }

    public async Task<List<ExtractedEntity>> ExtractAsync(
        string text,
        CancellationToken cancellationToken = default)
    {
        var full = await ExtractFullAsync(text, cancellationToken);
        return full.Entities;
    }

    public async Task<FullExtractionResult> ExtractFullAsync(
        string text,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(text))
            return new FullExtractionResult();

        var systemPrompt = """
            You are a named entity and relationship extraction engine for a memory platform.

            Your job is to identify important named entities, relationships between those entities,
            and optionally any explicit occurrence time in the given text.

            Entity types (use exactly):
            PERSON, ORGANIZATION, PRODUCT, TECHNOLOGY, LOCATION, PROJECT, COMPANY, TOOL, CONCEPT

            Rules:
            - Extract only entities that are explicitly named (not vague references).
            - Normalize displayName to the canonical capitalization seen in the text.
            - Normalize normalizedName to lowercase, trimmed, no special characters except hyphens.
            - For relationships, source and target MUST correspond to named entities in the text.
            - relationshipType should be concise and lowercase (e.g. "works_at", "uses", "located_in", "created").
            - confidence should be between 0.0 and 1.0.
            - If text mentions an explicit event date or time when this occurred or is scheduled, return occurredAt in ISO 8601 format (e.g. "2024-10-06T12:00:00Z"). Otherwise return null.
            - Return at most 10 entities and 10 relationships per call.
            - If there are no entities, return empty arrays.

            Return ONLY valid JSON in this exact format:
            {
              "entities": [
                {
                  "displayName": "PostgreSQL",
                  "normalizedName": "postgresql",
                  "entityType": "TECHNOLOGY"
                }
              ],
              "relationships": [
                {
                  "source": "Alice",
                  "target": "PostgreSQL",
                  "relationshipType": "uses",
                  "confidence": 0.95
                }
              ],
              "occurredAt": null
            }
            """;

        var request = new LlmCompletionRequest
        {
            SystemPrompt = systemPrompt,
            UserPrompt = text,
            Temperature = 0.0,
            EnforceJsonOutput = true
        };

        try
        {
            var content = await _llmProvider.GenerateChatCompletionAsync(request, cancellationToken);

            if (string.IsNullOrWhiteSpace(content))
                return new FullExtractionResult();

            var extraction = JsonSerializer.Deserialize<EntityExtractionResponse>(
                content,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (extraction == null)
                return new FullExtractionResult();

            var result = new FullExtractionResult();

            // Normalise and validate entities
            if (extraction.Entities != null)
            {
                foreach (var e in extraction.Entities)
                {
                    if (string.IsNullOrWhiteSpace(e.DisplayName) ||
                        string.IsNullOrWhiteSpace(e.NormalizedName) ||
                        string.IsNullOrWhiteSpace(e.EntityType))
                        continue;

                    var entityType = e.EntityType.Trim().ToUpperInvariant();
                    if (!ValidEntityTypes.Contains(entityType))
                        entityType = "CONCEPT"; // safe default

                    result.Entities.Add(new ExtractedEntity
                    {
                        DisplayName    = e.DisplayName.Trim(),
                        NormalizedName = e.NormalizedName.Trim().ToLowerInvariant(),
                        EntityType     = entityType
                    });
                }
            }

            // Normalise and validate relationships
            if (extraction.Relationships != null)
            {
                foreach (var r in extraction.Relationships)
                {
                    if (string.IsNullOrWhiteSpace(r.Source) ||
                        string.IsNullOrWhiteSpace(r.Target) ||
                        string.IsNullOrWhiteSpace(r.RelationshipType))
                        continue;

                    var conf = r.Confidence ?? 0.8;
                    if (conf < 0.0) conf = 0.0;
                    if (conf > 1.0) conf = 1.0;

                    result.Relationships.Add(new ExtractedRelationship
                    {
                        Source           = r.Source.Trim(),
                        Target           = r.Target.Trim(),
                        RelationshipType = r.RelationshipType.Trim().ToLowerInvariant(),
                        Confidence       = conf
                    });
                }
            }

            // Parse OccurredAt if present
            if (!string.IsNullOrWhiteSpace(extraction.OccurredAt) &&
                DateTime.TryParse(extraction.OccurredAt, out var parsedDate))
            {
                result.OccurredAt = DateTime.SpecifyKind(parsedDate, DateTimeKind.Utc);
            }

            return result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "[EntityExtraction] Extraction failed. Returning empty entities.");
            return new FullExtractionResult();
        }
    }
}

internal class EntityExtractionResponse
{
    public List<ExtractedEntity> Entities { get; set; } = new();
    public List<ExtractedRelationshipPayload>? Relationships { get; set; }
    public string? OccurredAt { get; set; }
}

internal class ExtractedRelationshipPayload
{
    public string? Source { get; set; }
    public string? Target { get; set; }
    public string? RelationshipType { get; set; }
    public double? Confidence { get; set; }
}
