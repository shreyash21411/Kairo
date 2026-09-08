using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

namespace Kairo.Application.Services;

public class ChatService : IChatService
{
    private readonly IChatRepository _chatRepository;

    public ChatService(IChatRepository chatRepository)
    {
        _chatRepository = chatRepository;
    }

    public async Task<long> IngestChatAsync(
        long userId,
        CreateChatRequest request)
    {
        if (userId <= 0)
        {
            throw new ArgumentException("Invalid userId.");
        }

        if (string.IsNullOrWhiteSpace(request.ExternalConversationId))
        {
            throw new ArgumentException(
                "External conversation ID is required.");
        }

        if (string.IsNullOrWhiteSpace(request.Source))
        {
            throw new ArgumentException(
                "Source is required.");
        }

        foreach (var message in request.Messages)
        {
            if (string.IsNullOrWhiteSpace(message.ExternalMessageId))
            {
                throw new ArgumentException(
                    "External message ID is required.");
            }

            if (string.IsNullOrWhiteSpace(message.Role))
            {
                throw new ArgumentException(
                    "Message role is required.");
            }

            if (string.IsNullOrWhiteSpace(message.Content))
            {
                throw new ArgumentException(
                    "Message content is required.");
            }
        }

        var existingChatId =
            await _chatRepository
                .GetChatIdByExternalConversationIdAsync(
                    userId,
                    request.ExternalConversationId);

        long chatId;

        if (existingChatId.HasValue)
        {
            chatId = existingChatId.Value;
        }
        else
        {
            chatId = await _chatRepository.CreateChatAsync(
                userId,
                request.ExternalConversationId,
                request.Source,
                request.Name,
                request.ProjectId);
        }

        if (request.Messages.Count > 0)
        {
            await _chatRepository.AddMessagesAsync(
                chatId,
                request.Messages);
        }

        return chatId;
    }
}