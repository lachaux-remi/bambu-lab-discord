# Bambu printer CA bundle provenance

`bambu-printer-ca.pem` contains only public CA certificates used as trust anchors. It contains no printer leaf
certificate and no private key.

The bundle was copied from `resources/cert/printer.cer` in the official Bambu Lab BambuStudio repository at commit
[`9a530f77c23d8c3430d1dbef02e103cd8bd6480e`](https://github.com/bambulab/BambuStudio/blob/9a530f77c23d8c3430d1dbef02e103cd8bd6480e/resources/cert/printer.cer)
on 2026-08-19. The upstream file SHA-256 is
`36f2bcee347ec7adce719b5fd350099591a4d3d0ec4e039c7019890d78e152a0`; the vendored file has one final LF added and
SHA-256 `168852cde67cd9c7648de5f95b46f7b950d1627966d2da6a968fd9ef9d034910`. Certificate DER data is unchanged.
These machine-readable provenance values are kept in
[`bambu-ca-bundle.json`](../../../.github/bambu-ca-bundle.json).

The `Monitor Bambu printer CA bundle` GitHub Actions workflow compares the official file on BambuStudio's `master`
branch with the reviewed upstream SHA-256 every week and on manual dispatch. If it changes, the workflow opens one
deduplicated review issue. It never updates this bundle, commits certificates, or feeds downloaded data into a build or
release. A maintainer must inspect any new certificates and provenance, update the vendored file and metadata in a
reviewed change, and retain strict TLS validation.

BambuStudio is distributed under
[GNU AGPL-3.0](https://github.com/bambulab/BambuStudio/blob/9a530f77c23d8c3430d1dbef02e103cd8bd6480e/LICENSE).
The upstream certificate file has no separate per-file licensing notice. This copy is kept unmodified apart from the
final line ending, with its source and upstream license recorded here. The five certificates are required to cover the
original BBL CA and the newer RSA/ECC CA2 chains shipped by Bambu across printer models and firmware generations:

| Certificate | Issuer | SHA-256 fingerprint |
|-------------|--------|--------------------|
| BBL CA2 RSA | BBL CA2 RSA | `E9:8F:19:57:8B:3F:12:4A:CE:6B:8A:24:7F:FE:DA:52:DC:99:C8:9F:D4:E7:D2:0C:82:82:99:77:B7:F3:35:02` |
| BBL CA2 ECC | BBL CA2 ECC | `1F:99:D8:46:71:8C:8D:33:3A:C3:19:CB:8E:70:91:9A:B6:32:36:09:0F:BA:DD:E9:09:BA:4A:6F:08:67:A6:83` |
| BBL CA2 RSA | BBL CA | `3D:13:01:9B:45:A4:FA:8A:6C:B8:DC:0F:D7:BE:CB:B1:9B:B2:BF:0C:2F:CB:94:34:A9:34:5F:A5:86:80:DA:0B` |
| BBL CA2 ECC | BBL CA | `E8:98:48:32:24:F9:09:2F:57:5D:62:74:33:BB:21:ED:9D:12:5A:77:E3:63:5B:0D:A6:FC:18:FE:85:0A:02:D7` |
| BBL CA | BBL CA | `03:0B:CA:81:CE:CE:18:B7:EF:F3:CF:D2:B7:5D:09:D3:EF:CA:89:3B:C0:69:60:9E:37:FA:04:25:7F:E4:D8:40` |

[OpenBambuAPI's TLS documentation](https://github.com/Doridian/OpenBambuAPI/blob/main/tls.md) independently documents
that printer certificates use the printer serial as their TLS identity. The implementation therefore connects to the IP
address while passing the existing configured serial as `servername` for SNI and hostname verification.
