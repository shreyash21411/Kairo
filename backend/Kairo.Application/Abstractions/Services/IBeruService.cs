using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Service abstraction for the BERU Voice Agent reasoning engine.
/// Operates independently of the Memory and Continuity engines.
/// </summary>
public interface IBeruService
{
    /// <summary>
    /// Processes a spoken/text prompt from the user against Meta AI reasoning.
    /// Incorporates optional explicit project context when provided.
    /// </summary>
    Task<BeruChatResponse> ProcessChatAsync(
        BeruChatRequest request,
        CancellationToken cancellationToken = default);
}

