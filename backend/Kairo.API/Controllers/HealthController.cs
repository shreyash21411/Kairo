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

            var database = _context.Database.GetDbConnection().Database;

            return Ok(new
            {
                database,
                connected
            });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new
            {
                database = _context.Database.GetDbConnection().Database,
                connected = false,
                error = ex.Message
            });
        }
    }
}