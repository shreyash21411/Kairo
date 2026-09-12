using Kairo.Infrastructure.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Kairo.API.Controllers;

[ApiController]
[Route("api/health")]
public class HealthController : ControllerBase
{
    private readonly KairoDbContext _context;

    public HealthController(KairoDbContext context)
    {
        _context = context;
    }

    [HttpGet("database")]
    public async Task<IActionResult> DatabaseHealth()
    {
        try
        {
            var connected = await _context.Database.CanConnectAsync();

            return Ok(new
            {
                status = "Healthy",
                connected
            });
        }
        catch
        {
            // Do not leak exception messages, stack traces, SQL details,
            // connection strings, or the database name.
            return StatusCode(500, new
            {
                status = "Unhealthy",
                connected = false
            });
        }
    }
}