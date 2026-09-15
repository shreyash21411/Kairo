using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.DTOs;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Persistence.Entities;
using Microsoft.EntityFrameworkCore;
using Kairo.Application.Constants;

namespace Kairo.Infrastructure.Repositories;

public class ChatRepository : IChatRepository
{
    private readonly KairoDbContext _dbContext;

    public ChatRepository(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<long?> GetChatIdByExternalConversationIdAsync(
        long userId,
        string externalConversationId)
    {
        return await _dbContext.Chats
            .AsNoTracking()
            .Where(chat =>
                chat.UserId == userId &&
                chat.ExternalConversationId == externalConversationId &&
                !chat.IsDeleted)
            .Select(chat => (long?)chat.ChatId)
            .FirstOrDefaultAsync();
    }

    public async Task<long> CreateChatAsync(
        long userId,
        string externalConversationId,
        string source,
        string? name,
        long? projectId)
    {
        var chat = new Chats
        {
            UserId = userId,
            ExternalConversationId = externalConversationId,
            Source = source,
            Name = name,
            ProjectId = projectId,
            ProcessingStatus = ChatProcessingStatus.Captured,
            RawChatStatus = RawChatStatus.Active,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow,
            IsDeleted = false
        };

        _dbContext.Chats.Add(chat);

        await _dbContext.SaveChangesAsync();

        return chat.ChatId;
    }

    public async Task<bool> MessageExistsAsync(
        long chatId,
        string externalMessageId)
    {
        return await _dbContext.Messages
            .AsNoTracking()
            .AnyAsync(message =>
                message.ChatId == chatId &&
                message.ExternalMessageId == externalMessageId &&
                !message.IsDeleted);
    }

    public async Task AddMessagesAsync(
    long chatId,
    IEnumerable<CreateMessageRequest> messages)
{
    var newMessages = new List<Messages>();

    foreach (var message in messages)
    {
        var exists = await MessageExistsAsync(
            chatId,
            message.ExternalMessageId);

        if (exists)
        {
            continue;
        }

        newMessages.Add(new Messages
        {
            ChatId = chatId,
            ExternalMessageId = message.ExternalMessageId,
            Role = message.Role,
            Content = message.Content,
            CreatedAt = message.CreatedAt,
            UpdatedAt = DateTime.UtcNow,
            IsDeleted = false
        });
    }

    if (newMessages.Count == 0)
    {
        return;
    }

    _dbContext.Messages.AddRange(newMessages);

    await _dbContext.SaveChangesAsync();
}
public async Task<bool> MarkProcessingAsync(long chatId)
{
    var chat = await _dbContext.Chats
        .FirstOrDefaultAsync(chat =>
            chat.ChatId == chatId &&
            !chat.IsDeleted);

    if (chat == null)
    {
        return false;
    }

    chat.ProcessingStatus = ChatProcessingStatus.Processing;
    chat.ProcessingStartedAt = DateTime.UtcNow;
    chat.ProcessingError = null;
    chat.UpdatedAt = DateTime.UtcNow;

    await _dbContext.SaveChangesAsync();

    return true;
}
public async Task<bool> MarkProcessedAsync(long chatId)
{
    var chat = await _dbContext.Chats
        .FirstOrDefaultAsync(chat =>
            chat.ChatId == chatId &&
            !chat.IsDeleted);

    if (chat == null)
    {
        return false;
    }

    chat.ProcessingStatus = ChatProcessingStatus.Processed;
    chat.ProcessedAt = DateTime.UtcNow;
    chat.ProcessingError = null;
    chat.UpdatedAt = DateTime.UtcNow;

    await _dbContext.SaveChangesAsync();

    return true;
}
public async Task<bool> MarkProcessingFailedAsync(
    long chatId,
    string error)
{
    var chat = await _dbContext.Chats
        .FirstOrDefaultAsync(chat =>
            chat.ChatId == chatId &&
            !chat.IsDeleted);

    if (chat == null)
    {
        return false;
    }

    chat.ProcessingStatus = ChatProcessingStatus.Failed;
    chat.ProcessingError = error;
    chat.UpdatedAt = DateTime.UtcNow;

    await _dbContext.SaveChangesAsync();

    return true;
}
public async Task<bool> ArchiveRawChatAsync(long chatId)
{
    var chat = await _dbContext.Chats
        .FirstOrDefaultAsync(chat =>
            chat.ChatId == chatId &&
            !chat.IsDeleted);

    if (chat == null)
    {
        return false;
    }

    chat.RawChatStatus = RawChatStatus.Archived;
    chat.ArchivedAt = DateTime.UtcNow;
    chat.UpdatedAt = DateTime.UtcNow;

    await _dbContext.SaveChangesAsync();

    return true;
}

public async Task<List<CreateMessageRequest>> GetMessagesAsync(long chatId)
{
    return await _dbContext.Messages
        .AsNoTracking()
        .Where(message =>
            message.ChatId == chatId &&
            !message.IsDeleted)
        .OrderBy(message => message.CreatedAt)
        .Select(message => new CreateMessageRequest
        {
            ExternalMessageId = message.ExternalMessageId,
            Role = message.Role,
            Content = message.Content,
            CreatedAt = message.CreatedAt
        })
        .ToListAsync();
}
public async Task<long?> GetUserIdByChatIdAsync(long chatId)
{
    return await _dbContext.Chats
        .AsNoTracking()
        .Where(chat =>
            chat.ChatId == chatId &&
            !chat.IsDeleted)
        .Select(chat => (long?)chat.UserId)
        .FirstOrDefaultAsync();
}

public async Task<long?> GetProjectIdByChatIdAsync(long chatId)
{
    return await _dbContext.Chats
        .AsNoTracking()
        .Where(chat =>
            chat.ChatId == chatId &&
            !chat.IsDeleted)
        .Select(chat => chat.ProjectId)
        .FirstOrDefaultAsync();
}
}