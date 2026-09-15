using Kairo.Application.DTOs;

namespace Kairo.Application.Abstractions.Persistence;

public interface IChatRepository
{
    Task<long?> GetChatIdByExternalConversationIdAsync(
        long userId,
        string externalConversationId);

    Task<long> CreateChatAsync(
        long userId,
        string externalConversationId,
        string source,
        string? name,
        long? projectId);

    Task AddMessagesAsync(
        long chatId,
        IEnumerable<CreateMessageRequest> messages);

    Task<bool> MessageExistsAsync(
        long chatId,
        string externalMessageId);
        Task<bool> MarkProcessingAsync(long chatId);

Task<bool> MarkProcessedAsync(long chatId);

Task<bool> MarkProcessingFailedAsync(
    long chatId,
    string error);

Task<bool> ArchiveRawChatAsync(long chatId);


Task<List<CreateMessageRequest>> GetMessagesAsync(long chatId);
Task<long?> GetUserIdByChatIdAsync(long chatId);
Task<long?> GetProjectIdByChatIdAsync(long chatId);
}