/**
 * A throwaway self-signed certificate for tests that need a real TLS listener, generated for
 * CN=localhost and valid until 2126. It secures nothing: the key is public in this repository,
 * and it exists only so a test can start an https server without shelling out to openssl.
 */
export const SELF_SIGNED_KEY = `-----BEGIN PRIVATE KEY-----
MIIBeQIBADCCAQMGByqGSM49AgEwgfcCAQEwLAYHKoZIzj0BAQIhAP////8AAAAB
AAAAAAAAAAAAAAAA////////////////MFsEIP////8AAAABAAAAAAAAAAAAAAAA
///////////////8BCBaxjXYqjqT57PrvVV2mIa8ZR0GsMxTsPY7zjw+J9JgSwMV
AMSdNgiG5wSTamZ44ROdJreBn36QBEEEaxfR8uEsQkf4vOblY6RA8ncDfYEt6zOg
9KE5RdiYwpZP40Li/hp/m47n60p8D54WK84zV2sxXs7LtkBoN79R9QIhAP////8A
AAAA//////////+85vqtpxeehPO5ysL8YyVRAgEBBG0wawIBAQQg8eQb0bVq1ju5
wxOdYjheoL+FBX3aicSmNQX04su4MbahRANCAARCiHeo9UeRkTq3QwhTyKXZm8NG
7k4pIcmyuJXLQTzpYysWHpRR09P9JcnyWmaU5S64k5aE7FBjQX242H3ZkAyB
-----END PRIVATE KEY-----`;

export const SELF_SIGNED_CERT = `-----BEGIN CERTIFICATE-----
MIICMzCCAdmgAwIBAgIJANd2MheI5A34MAoGCCqGSM49BAMCMBQxEjAQBgNVBAMM
CWxvY2FsaG9zdDAgFw0yNjA4MjMxNTA0MzJaGA8yMTI2MDczMDE1MDQzMlowFDES
MBAGA1UEAwwJbG9jYWxob3N0MIIBSzCCAQMGByqGSM49AgEwgfcCAQEwLAYHKoZI
zj0BAQIhAP////8AAAABAAAAAAAAAAAAAAAA////////////////MFsEIP////8A
AAABAAAAAAAAAAAAAAAA///////////////8BCBaxjXYqjqT57PrvVV2mIa8ZR0G
sMxTsPY7zjw+J9JgSwMVAMSdNgiG5wSTamZ44ROdJreBn36QBEEEaxfR8uEsQkf4
vOblY6RA8ncDfYEt6zOg9KE5RdiYwpZP40Li/hp/m47n60p8D54WK84zV2sxXs7L
tkBoN79R9QIhAP////8AAAAA//////////+85vqtpxeehPO5ysL8YyVRAgEBA0IA
BEKId6j1R5GROrdDCFPIpdmbw0buTikhybK4lctBPOljKxYelFHT0/0lyfJaZpTl
LriTloTsUGNBfbjYfdmQDIGjHjAcMBoGA1UdEQQTMBGCCWxvY2FsaG9zdIcEfwAA
ATAKBggqhkjOPQQDAgNIADBFAiBLTh7kJfkGlb435qNAXAy3g9JxQ3Q2DBQJa10T
Nd+riQIhAMVAviJGOgeezLlI7HR9vS7eUaFFAKWGMKMyhoFTh79s
-----END CERTIFICATE-----`;
