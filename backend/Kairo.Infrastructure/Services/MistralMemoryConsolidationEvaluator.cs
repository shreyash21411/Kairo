using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

public class MistralMemoryConsolidationEvaluator : IMemoryConsolidationEvaluator
{
    private readonly HttpClient _httpClient;
    private readonly MistralOptions _options;

    public MistralMemoryConsolidationEvaluator(
        HttpClient httpClient,
        IOptions<MistralOptions> options)
    {
        _httpClient = httpClient;
        _options = options.Value;
    }

    public async Task<ConsolidationEvaluationResult> EvaluateAsync(
        MemoryConsolidationCandidate candidate)
    {
        var userContent = JsonSerializer.Serialize(new
        {
            memoryA = candidate.ContentA,
            memoryB = candidate.ContentB
        });

        var requestBody = new
        {
            model = _options.Model,
            temperature = 0,
            response_format = new { type = "json_object" },
            messages = new object[]
            {
                new
                {
                    role = "system",
                    content =
                        """
                        You are a memory consolidation evaluator for an AI memory system.

                        Given two memory statements (memoryA and memoryB), determine
                        whether they encode exactly the same real-world knowledge or fact.

                        Return a JSON object using exactly this structure:

                        If they ARE the same knowledge:
                        {
                          "isSameKnowledge": true,
                          "canonicalContent": "A single concise statement that captures the shared knowledge",
                          "reason": "Brief explanation of why they are the same"
                        }

                        If they are NOT the same knowledge:
                        {
                          "isSameKnowledge": false,
                          "canonicalContent": null,
                          "reason": "Brief explanation of why they are different"
                        }

                        Rules:
                        - Two memories are the SAME knowledge only if they convey
                          identical facts or are direct paraphrases of each other.
                        - Memories about related but distinct topics (e.g., two
                          different technologies used in the same project) are NOT
                          the same, even if they share context.
                        - Do NOT consolidate memories that contain different
                          specific facts.
                        - Be conservative. When in doubt, return isSameKnowledge: false.
                        - Never invent information not present in either memory.
                        """
                },
                new
                {
                    role = "user",
                    content = userContent
                }
            }
        };

        using var httpRequest = new HttpRequestMessage(
            HttpMethod.Post,
            "https://api.mistral.ai/v1/chat/completions");

        httpRequest.Headers.Authorization =
            new AuthenticationHeaderValue("Bearer", _options.ApiKey);

        var json = JsonSerializer.Serialize(requestBody);

        httpRequest.Content = new StringContent(
            json,
            Encoding.UTF8,
            "application/json");

        using var response = await _httpClient.SendAsync(httpRequest);

        var responseContent =
            await response.Content.ReadAsStringAsync();

        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(
                $"Mistral consolidation evaluation failed. " +
                $"Status: {(int)response.StatusCode}. " +
                $"Response: {responseContent}");
        }

        using var document = JsonDocument.Parse(responseContent);

        var messageContent =
            document.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

        if (string.IsNullOrWhiteSpace(messageContent))
        {
            return FailSafe("Empty response from Mistral evaluator.");
        }

        try
        {
            using var resultDocument = JsonDocument.Parse(messageContent);
            var root = resultDocument.RootElement;

            if (!root.TryGetProperty("isSameKnowledge", out var sameKnowledgeEl))
            {
                return FailSafe(
                    "Response missing 'isSameKnowledge' field. Failing safe.");
            }

            var isSameKnowledge = sameKnowledgeEl.ValueKind == JsonValueKind.True;

            string? canonicalContent = null;
            if (root.TryGetProperty("canonicalContent", out var canonicalEl) &&
                canonicalEl.ValueKind == JsonValueKind.String)
            {
                canonicalContent = canonicalEl.GetString();
            }

            string? reason = null;
            if (root.TryGetProperty("reason", out var reasonEl) &&
                reasonEl.ValueKind == JsonValueKind.String)
            {
                reason = reasonEl.GetString();
            }

            // Safety: isSameKnowledge=true must come with a non-empty canonicalContent.
            if (isSameKnowledge && string.IsNullOrWhiteSpace(canonicalContent))
            {
                return FailSafe(
                    "Mistral returned isSameKnowledge=true but no canonicalContent. " +
                    "Failing safe to prevent data loss.");
            }

            return new ConsolidationEvaluationResult
            {
                IsSameKnowledge = isSameKnowledge,
                CanonicalContent = canonicalContent,
                Reason = reason
            };
        }
        catch (JsonException ex)
        {
            return FailSafe(
                $"Malformed JSON from Mistral evaluator: {ex.Message}");
        }
    }

    private static ConsolidationEvaluationResult FailSafe(string reason)
    {
        return new ConsolidationEvaluationResult
        {
            IsSameKnowledge = false,
            CanonicalContent = null,
            Reason = reason
        };
    }
}
