using Kairo.Application.DTOs;
namespace Kairo.Application.Abstractions.Services;


public interface IChatProcessingService
{
    Task<bool> ProcessChatAsync(long chatId);
    Task<WorkingSetTestResult> TestWorkingSetDedupAsync(
    WorkingSetTestRequest request);
}