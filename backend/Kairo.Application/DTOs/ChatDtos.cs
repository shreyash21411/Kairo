namespace Kairo.Application.DTOs;

public class CreateChatRequest
{
    public string ExternalConversationId { get; set; } = null!;

    public string Source { get; set; } = null!;

    public string? Name { get; set; }

    public long? ProjectId { get; set; }

    public List<CreateMessageRequest> Messages { get; set; } = new();
}
public class WorkingSetTestRequest
{
    public long UserId { get; set; }

    public ExtractedMemory MemoryA { get; set; } = null!;

    public ExtractedMemory MemoryB { get; set; } = null!;
}

public class WorkingSetTestResult
{
    public int InputMemoryCount { get; set; }
    public int CreatedMemoryCount { get; set; }
    public int ExactDuplicateCount { get; set; }
    public int SemanticDuplicateCount { get; set; }
    public List<long> CreatedMemoryIds { get; set; } = new();
}

public class ChatProcessingResult
{
    public bool Success { get; set; }
    public string? Message { get; set; }
    public int ExtractedMemoryCount { get; set; }
    public int CreatedMemoryCount { get; set; }
    public int SkippedMemoryCount { get; set; }
    public string? MemorySkipReason { get; set; }
}