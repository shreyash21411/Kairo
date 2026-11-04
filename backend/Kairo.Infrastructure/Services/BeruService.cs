using System;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.Abstractions.Meta;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.Configuration;
using Kairo.Application.DTOs;
using Microsoft.Extensions.Options;

namespace Kairo.Infrastructure.Services;

/// <summary>
/// Dedicated implementation for the BERU Voice Agent reasoning engine.
/// Reuses IMetaAIClient safely without modifying Memory or Continuity prompts or schemas.
/// </summary>
public class BeruService : IBeruService
{
    private readonly IMetaAIClient _client;
    private readonly BeruOptions _options;

    private const string BeruSystemPrompt =
        "You are BERU, the intelligent voice-first AI assistant for VOIDZONE.\n" +
        "You converse directly with software engineers, helping them understand their active projects, recall confirmed decisions, review outstanding tasks, and determine next development steps.\n\n" +
        "Guidelines for voice communication:\n" +
        "1. Speak clearly, concisely, and naturally. The user is listening to your answer via text-to-speech.\n" +
        "2. Keep responses brief and conversational (typically 2-4 sentences unless detailed explanation is asked).\n" +
        "3. Avoid markdown syntax, bullet points, tables, headers, and code fences unless the user explicitly requests code.\n" +
        "4. Rely on the supplied project context when provided. If the user asks about an unknown topic, politely say you don't have that context.";

    public BeruService(IMetaAIClient client, IOptions<BeruOptions> options)
    {
        _client = client ?? throw new ArgumentNullException(nameof(client));
        _options = options?.Value ?? throw new ArgumentNullException(nameof(options));
    }

    /// <inheritdoc />
    public async Task<BeruChatResponse> ProcessChatAsync(
        BeruChatRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!_options.Enabled)
            throw new InvalidOperationException("BERU voice agent is disabled in configuration.");

        if (request is null || string.IsNullOrWhiteSpace(request.Message))
            throw new ArgumentException("A valid message is required for BERU.", nameof(request));

        var sb = new StringBuilder();

        if (!string.IsNullOrWhiteSpace(request.ProjectContext))
        {
            sb.AppendLine("=== ACTIVE PROJECT CONTEXT ===");
            sb.AppendLine(request.ProjectContext.Trim());
            sb.AppendLine("=== END CONTEXT ===");
            sb.AppendLine();
        }

        if (request.History is { Count: > 0 })
        {
            sb.AppendLine("=== PRIOR CONVERSATION TURNS ===");
            foreach (var turn in request.History)
            {
                var role = string.Equals(turn.Role, "assistant", StringComparison.OrdinalIgnoreCase)
                    ? "BERU"
                    : "User";
                sb.AppendLine($"{role}: {turn.Content}");
            }
            sb.AppendLine();
        }

        sb.AppendLine($"User asks: {request.Message.Trim()}");

        var metaRequest = new MetaAIRequest
        {
            SystemPrompt = BeruSystemPrompt,
            UserPrompt   = sb.ToString(),
            Temperature  = _options.Temperature,
            OutputSchema = null // Natural language conversational reply (no schema constraint)
        };

        var response = await _client.CompleteAsync(metaRequest, cancellationToken).ConfigureAwait(false);

        return new BeruChatResponse
        {
            Reply       = response.Content?.Trim() ?? string.Empty,
            TokenUsage  = response.TokenUsage,
            RespondedAt = DateTime.UtcNow.ToString("O")
        };
    }
}

