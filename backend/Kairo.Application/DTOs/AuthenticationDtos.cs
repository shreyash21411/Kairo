namespace Kairo.Application.DTOs;

public sealed record TokenPair(
    string AccessToken,
    int ExpiresIn,
    string RefreshToken);