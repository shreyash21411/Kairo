using Kairo.Application.DTOs;
namespace Kairo.Application.Abstractions.Services;


public interface IChatProcessingService
{
    Task<ChatProcessingResult> ProcessChatAsync(long chatId);
    Task<WorkingSetTestResult> TestWorkingSetDedupAsync(
        WorkingSetTestRequest request);
}