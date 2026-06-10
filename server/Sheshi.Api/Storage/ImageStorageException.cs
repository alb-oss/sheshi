namespace Sheshi.Api.Storage;

public class ImageStorageException(string code) : Exception(code)
{
    public string Code { get; } = code;
}
