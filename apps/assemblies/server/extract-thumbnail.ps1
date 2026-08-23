# extract-thumbnail.ps1
# Uses the Windows Shell IShellItemImageFactory API to extract thumbnails
# from .sldasm / .sldprt files. Works because eDrawings registers a
# Shell thumbnail provider (edrwthumbnailprovider.dll) for these extensions.
#
# Usage:
#   powershell -NoProfile -File extract-thumbnail.ps1 -InputFile "N:\...\file.sldasm" -OutputFile "C:\...\thumb.png"
#   powershell -NoProfile -File extract-thumbnail.ps1 -InputFile "..." -OutputFile "...thumb.jpg" -Size 1024 -JpegQuality 85
#
# Output format is determined by the OutputFile extension (.png or .jpg/.jpeg).
# Default size 1024 → renders at 1280x960 (4:3), sharp on any display at ~25KB JPEG.

param(
  [Parameter(Mandatory=$true)]  [string] $InputFile,
  [Parameter(Mandatory=$true)]  [string] $OutputFile,
  [int] $Size         = 1024,   # Request size — provider renders larger and scales to fit
  [int] $JpegQuality  = 85      # JPEG quality 1-100 (only used when OutputFile ends in .jpg/.jpeg)
)

Add-Type -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

public class ShellThumbnail
{
    [ComImport]
    [Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItemImageFactory
    {
        void GetImage(
            [In, MarshalAs(UnmanagedType.Struct)] SIZE size,
            [In] SIIGBF flags,
            [Out] out IntPtr phbm);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SIZE { public int cx; public int cy; }

    [Flags]
    private enum SIIGBF : int
    {
        ResizeToFit  = 0x000,
        BiggerSizeOk = 0x001,
        MemoryOnly   = 0x002,
        IconOnly     = 0x004,
        ThumbnailOnly = 0x008,
        InCacheOnly  = 0x010,
        CropToSquare = 0x020,
        WideThumbnails = 0x040,
        IconBackground = 0x080,
        ScaleUp      = 0x100,
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(
        [In] string pszPath,
        [In] IntPtr pbc,
        [In] ref Guid riid,
        [Out, MarshalAs(UnmanagedType.Interface, IidParameterIndex = 2)] out IShellItemImageFactory ppv);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    static readonly Guid IID = new Guid("bcc18b79-ba16-442f-80c4-8a59c30c463b");

    public static void Save(string inputPath, string outputPath, int size, int jpegQuality)
    {
        IShellItemImageFactory factory;
        Guid iid = IID;
        SHCreateItemFromParsingName(inputPath, IntPtr.Zero, ref iid, out factory);

        SIZE sz = new SIZE { cx = size, cy = size };
        IntPtr hbm = IntPtr.Zero;
        
        // Try different flags if the standard ones fail
        // 0x0 = ResizeToFit, 0x1 = BiggerSizeOk, 0x8 = ThumbnailOnly
        int[] flagSets = { 0x9, 0x1, 0x0 }; 
        
        Exception lastEx = null;
        foreach (int f in flagSets)
        {
            try {
                factory.GetImage(sz, (SIIGBF)f, out hbm);
                if (hbm != IntPtr.Zero) break;
            } catch (Exception ex) {
                lastEx = ex;
            }
        }

        if (hbm == IntPtr.Zero)
            throw lastEx ?? new Exception("GetImage returned null HBITMAP (all flags failed)");

        string ext = System.IO.Path.GetExtension(outputPath).ToLower();
        bool isJpeg = (ext == ".jpg" || ext == ".jpeg");

        using (Bitmap bmp = Image.FromHbitmap(hbm))
        {
            if (isJpeg)
            {
                // Composite onto white background first (HBITMAP may have transparency)
                using (Bitmap canvas = new Bitmap(bmp.Width, bmp.Height, PixelFormat.Format24bppRgb))
                using (Graphics g = Graphics.FromImage(canvas))
                {
                    g.Clear(Color.White);
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode     = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
                    g.DrawImage(bmp, 0, 0, bmp.Width, bmp.Height);

                    var jpegEncoder = GetEncoder(ImageFormat.Jpeg);
                    var qualityParam = new EncoderParameters(1);
                    qualityParam.Param[0] = new EncoderParameter(Encoder.Quality, (long)jpegQuality);
                    canvas.Save(outputPath, jpegEncoder, qualityParam);
                }
            }
            else
            {
                bmp.Save(outputPath, ImageFormat.Png);
            }
        }
        DeleteObject(hbm);
    }

    private static ImageCodecInfo GetEncoder(ImageFormat format)
    {
        foreach (var codec in ImageCodecInfo.GetImageEncoders())
            if (codec.FormatID == format.Guid) return codec;
        throw new Exception("Encoder not found for format: " + format);
    }
}
"@ -ReferencedAssemblies System.Drawing

try {
    $fullInput  = [System.IO.Path]::GetFullPath($InputFile)
    $fullOutput = [System.IO.Path]::GetFullPath($OutputFile)

    [ShellThumbnail]::Save($fullInput, $fullOutput, $Size, $JpegQuality)
    Write-Output "OK:$fullOutput"
}
catch {
    Write-Error "FAIL: $($_.Exception.Message)"
    exit 1
}
