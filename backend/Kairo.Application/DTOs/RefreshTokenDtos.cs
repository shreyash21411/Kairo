namespace Kairo.Application.DTOs;

public sealed record RefreshTokenData(
    long RefreshTokenId,
    long UserId,
    string TokenHash,
    Guid FamilyId,
    DateTime ExpiresAt,
    DateTime CreatedAt,
    DateTime? RevokedAt,
    long? ReplacedByTokenId);