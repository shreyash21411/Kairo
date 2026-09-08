using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Services;

public interface IChatService
{
    Task<long> IngestChatAsync(
        long userId,
        CreateChatRequest request);
}