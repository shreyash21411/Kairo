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
        if (string.IsNullOrWhiteSpace(text))
            return new List<ExtractedEntity>();

        var systemPrompt = """
            You are a named entity extraction engine for a memory platform.

            Your job is to identify important named entities in the given text
            that represent people, organizations, products, technologies, locations,
            projects, companies, tools, or key concepts.

            Entity types (use exactly):
            PERSON, ORGANIZATION, PRODUCT, TECHNOLOGY, LOCATION, PROJECT, COMPANY, TOOL, CONCEPT

            Rules:
            - Extract only entities that are explicitly named (not vague references like "a tool" or "some library").
            - Normalize displayName to the canonical capitalization seen in the text.
            - Normalize normalizedName to lowercase, trimmed, no special characters except hyphens.
            - Do NOT extract common words, stop words, or filler.
            - Return at most 10 entities per call.
            - If there are no entities, return an empty list.

            Return ONLY valid JSON in this exact format:
            {
              "entities": [
                {
                  "displayName": "PostgreSQL",
                  "normalizedName": "postgresql",
                  "entityType": "TECHNOLOGY"
                }
              ]
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
                return new List<ExtractedEntity>();
            }

            using var document = JsonDocument.Parse(responseContent);
            var content = document.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

            if (string.IsNullOrWhiteSpace(content))
                return new List<ExtractedEntity>();

            var extraction = JsonSerializer.Deserialize<EntityExtractionResponse>(
                content,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

            if (extraction?.Entities == null)
                return new List<ExtractedEntity>();

            // Normalise and validate
            var result = new List<ExtractedEntity>();
            foreach (var e in extraction.Entities)
            {
                if (string.IsNullOrWhiteSpace(e.DisplayName) ||
                    string.IsNullOrWhiteSpace(e.NormalizedName) ||
                    string.IsNullOrWhiteSpace(e.EntityType))
                    continue;

                var entityType = e.EntityType.Trim().ToUpperInvariant();
                if (!ValidEntityTypes.Contains(entityType))
                    entityType = "CONCEPT"; // safe default

                result.Add(new ExtractedEntity
                {
                    DisplayName    = e.DisplayName.Trim(),
                    NormalizedName = e.NormalizedName.Trim().ToLowerInvariant(),
                    EntityType     = entityType
                });
            }

            return result;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex,
                "[EntityExtraction] Extraction failed. Returning empty entities.");
            return new List<ExtractedEntity>();
        }
    }
}

internal class EntityExtractionResponse
{
    public List<ExtractedEntity> Entities { get; set; } = new();
}
