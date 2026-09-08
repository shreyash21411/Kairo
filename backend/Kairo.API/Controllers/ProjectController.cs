using Kairo.Application.Abstractions.Security;
using Kairo.Application.Abstractions.Services;
using Kairo.Application.DTOs;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Kairo.API.Controllers;

[ApiController]
[Route("api/v1/projects")]
[Authorize]
[Produces("application/json")]
public class ProjectController : ControllerBase
{
    private readonly IProjectService _projectService;
    private readonly IApiKeyContext _apiKeyContext;

    public ProjectController(
        IProjectService projectService,
        IApiKeyContext apiKeyContext)
    {
        _projectService = projectService;
        _apiKeyContext = apiKeyContext;
    }

    // POST: /api/v1/projects
    [HttpPost]
    [ProducesResponseType(typeof(ProjectResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    public async Task<IActionResult> Create(
        [FromBody] CreateProjectRequest request)
    {
        try
        {
            var userId = _apiKeyContext.UserId;

            var result =
                await _projectService.CreateAsync(userId, request);

            return Ok(result);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new
            {
                message = ex.Message
            });
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new
                {
                    message = "An unexpected error occurred."
                });
        }
    }

    // GET: /api/v1/projects
    [HttpGet]
    [ProducesResponseType(typeof(List<ProjectResponse>), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetByUser()
    {
        try
        {
            var userId = _apiKeyContext.UserId;

            var result =
                await _projectService.GetByUserAsync(userId);

            return Ok(result);
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new
                {
                    message = "An unexpected error occurred."
                });
        }
    }

    // GET: /api/v1/projects/{projectId}
    [HttpGet("{projectId:long}")]
    [ProducesResponseType(typeof(ProjectResponse), StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> GetById(
        long projectId)
    {
        try
        {
            var userId = _apiKeyContext.UserId;

            var result =
                await _projectService.GetByIdAsync(
                    projectId,
                    userId);

            if (result == null)
            {
                return NotFound(new
                {
                    message =
                        "Project was not found or does not belong to the authenticated user."
                });
            }

            return Ok(result);
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new
                {
                    message = "An unexpected error occurred."
                });
        }
    }

    // DELETE: /api/v1/projects/{projectId}
    [HttpDelete("{projectId:long}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status500InternalServerError)]
    public async Task<IActionResult> Delete(
        long projectId)
    {
        try
        {
            var userId = _apiKeyContext.UserId;

            var result =
                await _projectService.DeleteAsync(
                    projectId,
                    userId);

            if (!result)
            {
                return NotFound(new
                {
                    message =
                        "Project was not found or does not belong to the authenticated user."
                });
            }

            return Ok(new
            {
                message = "Project deleted successfully."
            });
        }
        catch (Exception)
        {
            return StatusCode(
                StatusCodes.Status500InternalServerError,
                new
                {
                    message = "An unexpected error occurred."
                });
        }
    }
}