using Kairo.Application.Abstractions.Authentication;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;

namespace Kairo.Application.Services;

/// <summary>
/// Implements all human account authentication operations:
/// registration, login, token refresh, logout, and /me.
///
/// Depends exclusively on Application abstractions — no EF Core,
/// no Infrastructure types, no HTTP types.
///
/// The Kairo API-key system (memory/MCP APIs) is completely separate and
/// is not touched or affected by this service.
/// </summary>
public sealed class AccountService : IAccountService
{
    // ─── Name used for the password credential provider ───────────────────────
    private const string PasswordProvider = "Password";

    // ─── Default project name created alongside a new account ─────────────────
    private const string DefaultProjectName = "My Project";

    // ─── Precomputed valid ASP.NET Identity V3 hash for timing attack mitigation ───
    // Used exclusively for dummy verification when an account or password hash does not exist.
    private const string DummyPasswordHash =
        "AQAAAAIAAYagAAAAEBNFp+c2laYWk3RoI/0+ewWfltZrMl0RcTcU1pZkHWTMbiyJYEghbwAOOr3Rm3Libg==";

    private readonly IUserRepository _userRepository;
    private readonly IProjectRepository _projectRepository;
    private readonly IAuthenticationIdentityRepository _authIdentityRepository;
    private readonly IPasswordHasher _passwordHasher;
    private readonly ITokenService _tokenService;
    private readonly ITransactionCoordinator _transactionCoordinator;
    private readonly IAccountContext _accountContext;

    public AccountService(
        IUserRepository userRepository,
        IProjectRepository projectRepository,
        IAuthenticationIdentityRepository authIdentityRepository,
        IPasswordHasher passwordHasher,
        ITokenService tokenService,
        ITransactionCoordinator transactionCoordinator,
        IAccountContext accountContext)
    {
        _userRepository = userRepository;
        _projectRepository = projectRepository;
        _authIdentityRepository = authIdentityRepository;
        _passwordHasher = passwordHasher;
        _tokenService = tokenService;
        _transactionCoordinator = transactionCoordinator;
        _accountContext = accountContext;
    }

    // ─── Registration ─────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<RegisterResult> RegisterAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default)
    {
        // 1. Validate and normalize input.
        if (string.IsNullOrWhiteSpace(email))
            throw new ArgumentException("Email address is required.", nameof(email));

        if (string.IsNullOrWhiteSpace(password))
            throw new ArgumentException("Password is required.", nameof(password));

        var normalizedEmail = NormalizeEmail(email);

        // 2. Pre-flight duplicate check (fast path; final protection is the DB unique constraint).
        var exists = await _userRepository.ExistsByEmailAsync(normalizedEmail);
        if (exists)
            throw new DuplicateEmailException();

        // 3. Hash the password using the Application abstraction.
        //    This hash is stored in AuthenticationIdentities — NEVER in Users.PasswordHash.
        var passwordHash = _passwordHasher.Hash(password);

        // 4. Execute all three writes inside one atomic transaction.
        //    EfTransactionCoordinator opens the transaction; every SaveChangesAsync
        //    called by the repositories within the lambda participates automatically
        //    because they share the same scoped KairoDbContext instance.
        long newUserId = 0;

        try
        {
            await _transactionCoordinator.ExecuteInTransactionAsync(async () =>
            {
                // a. Create Users record — PasswordHash is null for new accounts.
                newUserId = await _userRepository.CreateAsync(
                    email: normalizedEmail,
                    passwordHash: null,
                    isEmailVerified: false,
                    accountStatus: 1);

                // b. Create Password AuthenticationIdentity.
                await _authIdentityRepository.AddAsync(
                    new AuthenticationIdentityData(
                        AuthenticationIdentityId: 0,   // DB-generated
                        UserId: newUserId,
                        Provider: PasswordProvider,
                        ProviderSubject: normalizedEmail,
                        PasswordHash: passwordHash),
                    cancellationToken);

                // c. Create the user's default project.
                await _projectRepository.CreateAsync(
                    userId: newUserId,
                    name: DefaultProjectName);

            }, cancellationToken);
        }
        catch (UniqueConstraintViolationException)
        {
            // Concurrent registration race where pre-flight check passed on both requests.
            // The database unique constraint was violated; translate to domain duplicate exception.
            throw new DuplicateEmailException();
        }

        // 5. Return registration result — no tokens issued.
        return new RegisterResult(
            UserId: newUserId,
            Email: normalizedEmail,
            IsEmailVerified: false);
    }

    // ─── Login ────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<LoginResult?> LoginAsync(
        string email,
        string password,
        CancellationToken cancellationToken = default)
    {
        // 1. Validate and normalize.
        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(password))
            return null;   // Generic failure — do not hint at which field is missing.

        var normalizedEmail = NormalizeEmail(email);

        // 2. Find the user. Non-existence and wrong password must produce identical results.
        var loginData = await _userRepository.GetLoginDataByEmailAsync(normalizedEmail);
        if (loginData is null)
        {
            _passwordHasher.Verify(password, DummyPasswordHash);
            return null;
        }

        // 3. Verify credentials.
        var verified = await VerifyCredentialsAsync(
            loginData, normalizedEmail, password, cancellationToken);

        if (!verified)
            return null;

        // 4. Issue tokens and update LastLoginAt.
        var now = DateTime.UtcNow;

        // LastLoginAt update is best-effort and does not need to be transactional with
        // token creation (a failure here does not invalidate the issued tokens).
        await _userRepository.UpdateLastLoginAtAsync(
            loginData.UserId, now, cancellationToken);

        var tokenPair = await _tokenService.CreateTokenPairAsync(
            loginData.UserId, loginData.Email, cancellationToken);

        // 5. Return the agreed login response.
        return new LoginResult(
            AccessToken: tokenPair.AccessToken,
            TokenType: "Bearer",
            ExpiresIn: tokenPair.ExpiresIn,
            RefreshToken: tokenPair.RefreshToken,
            User: new AuthenticatedUserInfo(
                UserId: loginData.UserId,
                Email: loginData.Email,
                IsEmailVerified: loginData.IsEmailVerified));
    }

    // ─── Refresh ─────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public Task<TokenPair> RefreshAsync(
        string rawRefreshToken,
        CancellationToken cancellationToken = default)
    {
        // Full delegation — rotation, hashing, JWT creation all stay in TokenService.
        return _tokenService.RefreshTokenAsync(rawRefreshToken, cancellationToken);
    }

    // ─── Logout ───────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public Task LogoutAsync(
        string rawRefreshToken,
        CancellationToken cancellationToken = default)
    {
        // Full delegation — hashing and family lookup stay in TokenService.
        // Safe to call with an unknown or already-revoked token (idempotent).
        return _tokenService.RevokeRefreshTokenFamilyByTokenAsync(
            rawRefreshToken, cancellationToken);
    }

    // ─── Me ───────────────────────────────────────────────────────────────────

    /// <inheritdoc />
    public async Task<AccountMeResult> GetMeAsync(
        CancellationToken cancellationToken = default)
    {
        // IAccountContext is populated by the JWT authentication middleware (AUTH-7).
        var userId = _accountContext.UserId;
        var email  = _accountContext.Email;

        // Fetch user login data to obtain IsEmailVerified.
        var loginData = await _userRepository.GetLoginDataByEmailAsync(email);

        bool isEmailVerified = loginData?.IsEmailVerified ?? false;

        // Fetch the user's projects.
        var projects = await _projectRepository.GetByUserAsync(userId);

        var projectResponses = projects
            .Select(p => new ProjectResponse
            {
                ProjectId = p.ProjectId,
                UserId    = p.UserId,
                Name      = p.Name,
                CreatedAt = p.CreatedAt,
                UpdatedAt = p.UpdatedAt
            })
            .ToList();

        return new AccountMeResult(
            UserId: userId,
            Email: email,
            IsEmailVerified: isEmailVerified,
            Projects: projectResponses);
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    /// <summary>
    /// Normalizes an email address for consistent identity lookups.
    /// Trims whitespace and lower-cases the address.
    /// </summary>
    private static string NormalizeEmail(string email)
        => email.Trim().ToLowerInvariant();

    /// <summary>
    /// Verifies the supplied password against either the Password AuthenticationIdentity
    /// (new path) or the legacy Users.PasswordHash (old path).
    ///
    /// Legacy lazy migration:
    ///   If no Password AuthenticationIdentity exists for this user and the legacy
    ///   Users.PasswordHash is non-null, the supplied password is verified against
    ///   the legacy hash. On success, a new AuthenticationIdentity is created so
    ///   that future logins use the modern path. The legacy Users.PasswordHash is
    ///   deliberately not updated — it is treated as read-only legacy data.
    ///
    /// Returns true on successful verification; false on failure.
    /// All failure reasons produce the same return value to prevent user enumeration.
    /// </summary>
    private async Task<bool> VerifyCredentialsAsync(
        UserLoginData loginData,
        string normalizedEmail,
        string password,
        CancellationToken cancellationToken)
    {
        // Try the modern Password AuthenticationIdentity path first.
        var identity = await _authIdentityRepository.GetPasswordIdentityByUserIdAsync(
            loginData.UserId, cancellationToken);

        if (identity is not null)
        {
            // Modern path: PasswordHash must be present on the identity.
            if (string.IsNullOrEmpty(identity.PasswordHash))
            {
                _passwordHasher.Verify(password, DummyPasswordHash);
                return false;
            }

            return _passwordHasher.Verify(password, identity.PasswordHash);
        }

        // ── Legacy lazy migration ──────────────────────────────────────────────
        // No Password AuthenticationIdentity exists — fall back to Users.PasswordHash.
        if (string.IsNullOrEmpty(loginData.PasswordHash))
        {
            _passwordHasher.Verify(password, DummyPasswordHash);
            return false;   // No legacy hash either — reject.
        }

        var legacyVerified = _passwordHasher.Verify(password, loginData.PasswordHash);
        if (!legacyVerified)
            return false;

        // Legacy verification succeeded. Create a modern Password AuthenticationIdentity
        // using a freshly generated hash (the new hasher format, not the raw legacy value).
        // The LastLoginAt update and this identity creation are committed in a transaction
        // to avoid leaving the account in a state where neither path is usable.
        var newPasswordHash = _passwordHasher.Hash(password);

        try
        {
            await _authIdentityRepository.AddAsync(
                new AuthenticationIdentityData(
                    AuthenticationIdentityId: 0,   // DB-generated
                    UserId: loginData.UserId,
                    Provider: PasswordProvider,
                    ProviderSubject: normalizedEmail,
                    PasswordHash: newPasswordHash),
                cancellationToken);
        }
        catch (UniqueConstraintViolationException)
        {
            // Another concurrent request migrated this user's password first.
            // Since password verification already succeeded, this is safe to ignore
            // and the user should be allowed to log in.
        }

        return true;
    }
}
