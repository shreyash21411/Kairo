using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

/// <summary>
/// Phase 1: Mistral-backed entity extraction service.
/// Extracts named entities from memory content text.
/// Never throws on extraction failure — returns empty list.
/// </summary>
public class MistralEntityExtractionService : IEntityExtractionService
{
    private readonly HttpClient _httpClient;
    private readonly MistralOptions _options;
    private readonly ILogger<MistralEntityExtractionService> _logger;

    private static readonly HashSet<string> ValidEntityTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "PERSON", "ORGANIZATION", "PRODUCT", "TECHNOLOGY",
        "LOCATION", "PROJECT", "COMPANY", "TOOL", "CONCEPT"
    };

    public MistralEntityExtractionService(
        HttpClient httpClient,
        IOptions<MistralOptions> options,
        ILogger<MistralEntityExtractionService> logger)
    {
        _httpClient = httpClient;
        _options = options.Value;
        _logger = logger;
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

        var requestBody = new
        {
            model = _options.Model,
            temperature = 0.0,
            response_format = new { type = "json_object" },
            messages = new[]
            {
                new { role = "system", content = systemPrompt },
                new { role = "user",   content = text }
            }
        };

        using var request = new HttpRequestMessage(
            HttpMethod.Post,
            "https://api.mistral.ai/v1/chat/completions");

        request.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", _options.ApiKey);

        request.Content = new StringContent(
            JsonSerializer.Serialize(requestBody),
            Encoding.UTF8,
            "application/json");

        try
        {
            using var response = await _httpClient.SendAsync(request, cancellationToken);
            var responseContent = await response.Content.ReadAsStringAsync(cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "[EntityExtraction] Mistral API returned {Status}. Returning empty entities.",
                    (int)response.StatusCode);
                return new FullExtractionResult();
            }

            using var document = JsonDocument.Parse(responseContent);
            var content = document.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

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

                    result.Relationships.Add(new ExtractedRelationship
                    {
                        Source           = r.Source.Trim(),
                        Target           = r.Target.Trim(),
                        RelationshipType = r.RelationshipType.Trim().ToLowerInvariant(),
                        Confidence       = r.Confidence.HasValue ? Math.Clamp(r.Confidence.Value, 0.0, 1.0) : 1.0
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
