# Setting up with various providers
> [!NOTE]
> This page contains instructions on how to set up <a class="reference-link" href="../Signing%20in%20with%20OpenID%20Connect.md">Signing in with OpenID Connect</a> with various providers such as Authelia, GitLab,. Google. Note that while the configuration reference is correct and up to date, the steps to create the OAuth application might differ slightly as providers change their UI.

## Authelia

1.  Generate a client secret:
    
    ```
    authelia crypto hash generate pbkdf2 --variant sha512 --random --random.length 72 --random.charset rfc3986
    
    ```
    
    `Random Password` goes to Trilium, `Digest` (the `$pbkdf2-sha512$…` string) goes to Authelia.
2.  Add a client under `identity_providers.oidc.clients` in Authelia's `configuration.yml`, replacing `<server>` with the URL of your Trilium instance:
    
    ```yaml
    identity_providers:
      oidc:
        clients:
          - client_id: 'trilium'
            client_name: 'Trilium'
            client_secret: '<Digest>'
            public: false
            authorization_policy: 'two_factor'
            redirect_uris:
              - 'https://<server>/callback'
            scopes:
              - 'openid'
              - 'profile'
              - 'email'
    ```
    
    Unlike GitLab, `client_id` is a name you choose rather than one the provider generates.
3.  Restart Authelia.

Adjust `config.ini`, using the `Random Password` from step 1:

```
[MultiFactorAuthentication]
oauthBaseUrl=https://<server>
oauthClientId=<ClientId>
oauthClientSecret=<RandomPassword>
oauthIssuerBaseUrl=https://<server>
oauthIssuerName=Authelia
```

> [!IMPORTANT]
> Do **not** set `oauthClientAuthMethod` for Authelia. It defaults confidential clients to `client_secret_basic` and rejects any other method with `invalid_client`, which is the default Trilium already uses. This is the opposite of the GitLab case below.

## GitLab (self-hosted or cloud)

1.  Go to user settings on [gitlab.com](https://gitlab.com/-/user_settings/applications) or your own self-hosted instance.
2.  Press _Add new application_.
3.  Give it a name (e.g. Trilium).
4.  Set _Redirect URI_ to `https://<server>/callback`
5.  Make sure _Confidential_ is checked and _Device authorization grant_ is unchecked.
6.  Under scopes, check _openid_, _profile_ and _email_ (they should be near the end).
7.  Save the application and copy the _Application ID_ and _Secret_.

Adjust `config.ini` as follows, replacing `<ApplicationId>` and `<Secret>` with the values from the last step as well as the `<server>` with a URL to your Trilium instance.

```
[MultiFactorAuthentication]
oauthBaseUrl=https://<server>
oauthClientId=<ApplicationId>
oauthClientSecret=<Secret>
oauthIssuerBaseUrl=https://gitlab.com
oauthIssuerName=GitLab
oauthClientAuthMethod=client_secret_post

```

> [!IMPORTANT]
> If you are using a self-hosted instance of GitLab, make sure to also update `oauthIssuerBaseUrl`, and keep the `oauthClientAuthMethod` line above.
> 
> GitLab's token endpoint does not decode credentials sent via HTTP Basic, so without `oauthClientAuthMethod`, sign-in fails with a `server responded with a challenge in the WWW-Authenticate HTTP Header` error. Trilium applies this automatically for `gitlab.com`, but a self-hosted issuer URL cannot be detected.

## GitHub

GitHub cannot be used as an identity provider because it is plain OAuth 2.0 and not OpenID Connect, so it will fail with `OAUTH_RESPONSE_IS_NOT_CONFORM`.

## Google

1.  Go to [Google Cloud's Clients](https://console.cloud.google.com/auth/clients) dashboard and select _Create client_.
2.  For _Application type,_ select _Web application_.
3.  In _Authorized redirect URIs_, set  `https://<server>/callback`.
4.  Press _Create_ and copy _Client ID_ and _Client secret_.

Adjust `config.ini` as follows, replacing `<ClientID>` and `<ClientSecret>` with the values from the last step as well as the `<server>` with a URL to your Trilium instance.

```
[MultiFactorAuthentication]
oauthBaseUrl=https://<server>
oauthClientId=<ClientID>
oauthClientSecret=<ClientSecret>
```