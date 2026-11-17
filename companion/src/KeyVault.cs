// The own server's key at rest on Windows (the owner's decision, 2026-11-17): server.json keeps it encrypted with
// DPAPI for this Windows account (ProtectedData, CurrentUser) as "keyProtected", never as plain text. A plain "key"
// (typed into the file, or from an older companion) is read once and the file saved again encrypted
// (OwnServer.OpenKey decides; Controller.ReadServer writes). Another account or PC can't open it: the companion then
// asks for the key again.
// C# 5 only (csc 4.8): no $"", no ?., no => members, no nameof, no out var.
using System;
using System.Security.Cryptography;
using System.Text;

namespace MtgCompanion
{
    public static class KeyVault
    {
        public const string Field = "keyProtected";
        // (fixed extra entropy: another program running as the same account can't open the blob without it)
        static readonly byte[] Entropy = Encoding.UTF8.GetBytes("MTG Companion own-server key v1");

        public static string Protect(string key)
        {
            return Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(key), Entropy, DataProtectionScope.CurrentUser));
        }

        // Whether a DPAPI blob was made for the machine rather than the account: Windows' blob starts with its version,
        // the DPAPI provider's GUID (df9d8cd0-1501-11d1-8c7a-00c04fc297eb), the master key's version and GUID, then
        // dwFlags at byte 40, where CRYPTPROTECT_LOCAL_MACHINE is 0x4. null: not a Windows DPAPI blob (mono's own format),
        // so it can't say. (Windows opens either kind with either scope, so a round trip alone can't tell them apart.)
        static readonly byte[] Provider = { 0xd0, 0x8c, 0x9d, 0xdf, 0x01, 0x15, 0xd1, 0x11, 0x8c, 0x7a, 0x00, 0xc0, 0x4f, 0xc2, 0x97, 0xeb };
        public static bool? MachineScoped(byte[] blob)
        {
            if (blob == null || blob.Length < 44) return null;
            for (int i = 0; i < Provider.Length; i++) if (blob[4 + i] != Provider[i]) return null;
            var flags = BitConverter.ToUInt32(blob, 40);
            return (flags & 0x4) != 0;
        }

        public static string Unprotect(string blob)
        {
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(blob), Entropy, DataProtectionScope.CurrentUser));
        }
    }
}
