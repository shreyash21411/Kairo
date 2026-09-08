namespace Kairo.Application.Constants;

public static class ChatProcessingStatus
{
    public const byte Captured = 1;
    public const byte Processing = 2;
    public const byte Processed = 3;
    public const byte Failed = 4;
}

public static class RawChatStatus
{
    public const byte Active = 1;
    public const byte Archived = 2;
    public const byte Deleted = 3;
}