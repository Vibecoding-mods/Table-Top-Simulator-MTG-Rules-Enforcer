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

        public static string Unprotect(string blob)
        {
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(blob), Entropy, DataProtectionScope.CurrentUser));
        }
    }
}
