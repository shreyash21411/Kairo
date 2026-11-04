using System.Threading;
using System.Threading.Tasks;
using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

/// <summary>
/// Continuity Engine operation powered by the Meta Model API.
/// Generates a structured continuity summary from a raw conversation transcript.
///
/// The result is a standalone document — it does NOT modify ContinuityArchive,
/// does NOT change schemaVersion (remains 1.0), does NOT alter archive hashing,
/// and is NOT embedded in any archive field.
///
/// Calls must be explicitly triggered by the user via VoidzoneController.
/// No automatic invocation on captured messages.
/// </summary>
public interface IMetaContinuityService
{
    /// <summary>
    /// Generates a structured continuity state summary from a raw conversation transcript.
    /// </summary>
    /// <param name="rawTranscript">Full raw transcript text.</param>
    /// <param name="platform">Source platform (e.g. "chatgpt", "claude").</param>
    /// <param name="title">Conversation or project title.</param>
    /// <param name="cancellationToken">Propagates caller cancellation.</param>
    /// <returns>Structured continuity result — standalone document, not persisted.</returns>
    Task<MetaContinuityResult> GenerateAsync(
        string rawTranscript,
        string platform,
        string title,
        CancellationToken cancellationToken = default);
}

