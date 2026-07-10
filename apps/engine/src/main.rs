use yet_lsp::{
    app, default_bind_addr,
    logging::{init_engine_logging, log_event, EngineLogLevel},
    lsp, AppState, AuthToken, ProductIdentity,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if lsp::lsp_stdio_requested(std::env::args().skip(1)) {
        lsp::run_lsp_stdio().await?;
        return Ok(());
    }

    let identity = ProductIdentity::load()?;
    let token = AuthToken::from_env_or_dev();
    let port = std::env::var("YET_AI_HTTP_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(8001);
    let _engine_log_guard = init_engine_logging(port);
    let auth_required = true;
    log_event(
        EngineLogLevel::Info,
        "http.server.start",
        &[
            ("port", &port as &dyn std::fmt::Display),
            ("auth_required", &auth_required as &dyn std::fmt::Display),
        ],
    );
    let addr = default_bind_addr(port);
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app(AppState::new(identity, token))).await?;
    Ok(())
}
