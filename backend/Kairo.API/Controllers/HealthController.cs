using Kairo.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kairo.API.Controllers;

[ApiController]
[Route("api/health")]
public class HealthController : ControllerBase
{
    private readonly KairoDbContext _dbContext;

    public HealthController(KairoDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("database")]
    public async Task<IActionResult> Database()
    {
        try
        {
            var connected = await _dbContext.Database.CanConnectAsync();

            return Ok(new
            {
                database = "SonaliDB",
                connected
            });
        }
        catch (Exception ex)
        {
            return Problem(
                title: "Database connection failed",
                detail: ex.Message
            );
        }
    }
}