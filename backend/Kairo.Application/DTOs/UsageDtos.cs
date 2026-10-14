namespace Kairo.Application.DTOs;

/// <summary>
/// Phase 5.8: Canonical string constants for all metered operation types.
/// Using constants instead of an enum keeps the contract SQL-portable.
/// </summary>
public static class UsageOperationType
{
    public const string MemoryCreate    = "MemoryCreate";
    public const string MemoryUpdate    = "MemoryUpdate";
    public const string MemoryDelete    = "MemoryDelete";
    public const string MemoryRecall    = "MemoryRecall";
    public const string MemoryGet       = "MemoryGet";
    public const string BatchCreate     = "BatchCreate";
    public const string BatchDelete     = "BatchDelete";
    public const string DialogueIngest  = "DialogueIngest";
    public const string LlmRerank       = "LlmRerank";
}

/// <summary>
/// Phase 5.8: Outcome for a metered operation.
/// </summary>
public static class UsageOutcome
{
    public const string Success   = "Success";
    public const string Failure   = "Failure";
    public const string Throttled = "Throttled";
}
