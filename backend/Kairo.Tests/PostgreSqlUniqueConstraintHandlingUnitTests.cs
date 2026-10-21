using System;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using Kairo.API.Controllers;
using Kairo.Application;
using Kairo.Application.Abstractions.Authentication;
using Kairo.Application.Abstractions.Persistence;
using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Kairo.Application.Services;
using Kairo.Infrastructure.Persistence;
using Kairo.Infrastructure.Repositories;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Moq;
using Npgsql;
using Xunit;

namespace Kairo.Tests;

/// <summary>
/// Unit tests for PostgreSQL unique-constraint violation handling (DB-001).
/// Verifies that:
/// 1. PostgreSQL SQLSTATE 23505 (UniqueViolation) is recognized by both AuthenticationIdentityRepository and EfTransactionCoordinator.
/// 2. Other database errors (foreign key, syntax, etc.) are NOT treated as unique violations.
/// 3. Duplicate email on registration returns HTTP 409 Conflict.
/// 4. UniqueConstraintViolationException in AccountService is cleanly translated to DuplicateEmailException.
/// 5. AuthController maps DuplicateEmailException to HTTP 409 Conflict rather than HTTP 500.
/// All tests are 100% offline with zero live database dependencies.
/// </summary>
public class PostgreSqlUniqueConstraintHandlingUnitTests
{
    // ─────────────────────────────────────────────────────────────────────────
    // 1. EfTransactionCoordinator - IsUniqueConstraintViolation
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void EfTransactionCoordinator_Recognizes_PostgreSqlUniqueViolation()
    {
        var pgEx = new PostgresException(
            messageText: "duplicate key value violates unique constraint \"UQ_Users_Email\"",
            severity: "ERROR",
            invariantSeverity: "ERROR",
            sqlState: PostgresErrorCodes.UniqueViolation); // "23505"

        var dbEx = new DbUpdateException("An error occurred while saving the entity changes.", pgEx);

        var isUnique = EfTransactionCoordinator.IsUniqueConstraintViolation(dbEx);

        Assert.True(isUnique, "Expected EfTransactionCoordinator to recognize PostgresException with SQLSTATE 23505 as a unique constraint violation.");
    }

    [Fact]
    public void EfTransactionCoordinator_Rejects_OtherPostgreSqlErrors()
    {
        var pgEx = new PostgresException(
            messageText: "insert or update on table violates foreign key constraint",
            severity: "ERROR",
            invariantSeverity: "ERROR",
            sqlState: PostgresErrorCodes.ForeignKeyViolation); // "23503"

        var dbEx = new DbUpdateException("An error occurred while saving the entity changes.", pgEx);

        var isUnique = EfTransactionCoordinator.IsUniqueConstraintViolation(dbEx);

        Assert.False(isUnique, "Expected EfTransactionCoordinator to reject PostgresException with non-23505 SQLSTATE.");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. AuthenticationIdentityRepository - IsUniqueConstraintViolation
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public void AuthenticationIdentityRepository_Recognizes_PostgreSqlUniqueViolation()
    {
        var pgEx = new PostgresException(
            messageText: "duplicate key value violates unique constraint \"UQ_AuthenticationIdentities_Provider_Subject\"",
            severity: "ERROR",
            invariantSeverity: "ERROR",
            sqlState: PostgresErrorCodes.UniqueViolation); // "23505"

        var dbEx = new DbUpdateException("An error occurred while saving the entity changes.", pgEx);

        var isUnique = AuthenticationIdentityRepository.IsUniqueConstraintViolation(dbEx);

        Assert.True(isUnique, "Expected AuthenticationIdentityRepository to recognize PostgresException with SQLSTATE 23505 as a unique constraint violation.");
    }

    [Fact]
    public void AuthenticationIdentityRepository_Rejects_OtherPostgreSqlErrors()
    {
        var pgEx = new PostgresException(
            messageText: "relation \"SomeTable\" does not exist",
            severity: "ERROR",
            invariantSeverity: "ERROR",
            sqlState: "42P01"); // UndefinedTable

        var dbEx = new DbUpdateException("An error occurred while saving the entity changes.", pgEx);

        var isUnique = AuthenticationIdentityRepository.IsUniqueConstraintViolation(dbEx);

        Assert.False(isUnique, "Expected AuthenticationIdentityRepository to reject PostgresException with SQLSTATE 42P01.");
    }

    [Fact]
    public void IsUniqueConstraintViolation_ReturnsFalse_WhenInnerExceptionIsNull()
    {
        var dbEx = new DbUpdateException("Generic update failure without inner exception.");

        Assert.False(EfTransactionCoordinator.IsUniqueConstraintViolation(dbEx));
        Assert.False(AuthenticationIdentityRepository.IsUniqueConstraintViolation(dbEx));
    }

    [Fact]
    public void IsUniqueConstraintViolation_ReturnsFalse_WhenInnerExceptionIsGenericException()
    {
        var dbEx = new DbUpdateException("Generic failure", new InvalidOperationException("Something else"));

        Assert.False(EfTransactionCoordinator.IsUniqueConstraintViolation(dbEx));
        Assert.False(AuthenticationIdentityRepository.IsUniqueConstraintViolation(dbEx));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. End-to-End Exception Mapping: AccountService -> DuplicateEmailException
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AccountService_RegisterAsync_WhenTransactionThrowsUniqueViolation_ThrowsDuplicateEmailException()
    {
        // Arrange
        var userRepoMock = new Mock<IUserRepository>();
        var authIdentityRepoMock = new Mock<IAuthenticationIdentityRepository>();
        var projectRepoMock = new Mock<IProjectRepository>();
        var passwordHasherMock = new Mock<IPasswordHasher>();
        var tokenServiceMock = new Mock<ITokenService>();
        var txCoordinatorMock = new Mock<ITransactionCoordinator>();
        var accountContextMock = new Mock<IAccountContext>();

        // Pre-flight check passes (user does not exist yet)
        userRepoMock
            .Setup(r => r.ExistsByEmailAsync("newuser@example.com"))
            .ReturnsAsync(false);

        // Password hashing works
        passwordHasherMock
            .Setup(h => h.Hash("ValidPassword123!"))
            .Returns("hashed-secret");

        // The transaction coordinator simulates a database unique constraint violation race
        txCoordinatorMock
            .Setup(t => t.ExecuteInTransactionAsync(It.IsAny<Func<Task>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new UniqueConstraintViolationException());

        var accountService = new AccountService(
            userRepoMock.Object,
            projectRepoMock.Object,
            authIdentityRepoMock.Object,
            passwordHasherMock.Object,
            tokenServiceMock.Object,
            txCoordinatorMock.Object,
            accountContextMock.Object);

        // Act & Assert: UniqueConstraintViolationException is caught and converted to DuplicateEmailException
        await Assert.ThrowsAsync<DuplicateEmailException>(() =>
            accountService.RegisterAsync("newuser@example.com", "ValidPassword123!"));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. End-to-End API Mapping: AuthController -> HTTP 409 Conflict
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AuthController_Register_WhenDuplicateEmailExceptionThrown_ReturnsHttp409Conflict()
    {
        // Arrange
        var accountServiceMock = new Mock<IAccountService>();
        accountServiceMock
            .Setup(s => s.RegisterAsync("existing@example.com", "Password123!", It.IsAny<CancellationToken>()))
            .ThrowsAsync(new DuplicateEmailException());

        var controller = new AuthController(accountServiceMock.Object);

        // Act
        var result = await controller.Register(new RegisterRequest
        {
            Email = "existing@example.com",
            Password = "Password123!"
        }, CancellationToken.None);

        // Assert
        var conflictResult = Assert.IsType<ConflictObjectResult>(result);
        Assert.Equal(StatusCodes.Status409Conflict, conflictResult.StatusCode);
    }


}
