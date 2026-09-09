using Kairo.Application.Abstractions.Services;
using Microsoft.Extensions.DependencyInjection;
using ModelContextProtocol.Server;

namespace Kairo.MCP.Extensions;

/// <summary>
/// Extension methods that register all Kairo MCP services.
///
/// Design principles:
///   - MCP is an adapter layer only. It delegates 100% to IMemoryService.
///   - No duplicate memory logic, repositories, or embeddings are created here.
///   - IMemoryService and IApiKeyContext are injected from the existing DI
///     registrations in Kairo.Application / Kairo.API. They are NOT
///     re-registered here.
///   - Tool classes are scoped so they share the same DI scope as the
///     per-request ApiKeyContext populated by KairoApiKeyAuthenticationHandler.
/// </summary>
public static class McpServiceExtensions
{
    /// <summary>
    /// Registers the Kairo MCP server and its tools with the DI container.
    ///
    /// Call this after all existing service registrations in Program.cs.
    /// The existing IMemoryService, IApiKeyContext, IApiKeyValidator, and
    /// KairoApiKeyAuthenticationHandler registrations are unchanged and reused.
    /// </summary>
    public static IServiceCollection AddKairoMcp(
        this IServiceCollection services)
    {
        // Verify that IMemoryService is already registered by the caller
        // (it is registered in Program.cs as part of Phase 8 — we just use it).
        //
        // AddMcpServer() registers the MCP server infrastructure.
        // .WithHttpTransport() activates Streamable HTTP (the modern MCP transport).
        // .WithToolsFromAssembly() discovers [McpServerToolType] classes in Kairo.MCP.
        //
        // Each tool invocation runs inside a fresh DI scope created by the SDK,
        // so scoped services (IMemoryService, IApiKeyContext) are resolved safely
        // per-request — exactly the same scope lifecycle as MemoryController uses.
        services
            .AddMcpServer()
            .WithHttpTransport()
            .WithToolsFromAssembly(typeof(McpServiceExtensions).Assembly);

        return services;
    }
}
