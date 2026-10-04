//! User-defined math channel Tauri commands.
//!
//! Math channels evaluate runtime expressions over output channels and
//! constants, exposing the result as a virtual channel for gauges and logs.

use crate::state::AppState;
use libretune_core::project::{save_math_channels, UserMathChannel};

#[tauri::command]
pub async fn get_math_channels(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<UserMathChannel>, String> {
    Ok(state.math_channels.lock().await.clone())
}

#[tauri::command]
pub async fn set_math_channel(
    state: tauri::State<'_, AppState>,
    mut channel: UserMathChannel,
) -> Result<(), String> {
    channel
        .compile()
        .map_err(|e| format!("Invalid expression: {}", e))?;

    let mut channels = state.math_channels.lock().await;

    if let Some(existing) = channels.iter_mut().find(|c| c.name == channel.name) {
        *existing = channel;
    } else {
        channels.push(channel);
    }

    let project = state.current_project.lock().await;
    if let Some(ref proj) = *project {
        let path = proj.path.join("math_channels.json");
        save_math_channels(&path, &channels)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_math_channel(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Result<(), String> {
    let mut channels = state.math_channels.lock().await;
    let initial_len = channels.len();
    channels.retain(|c| c.name != name);

    if channels.len() == initial_len {
        return Err(format!("Channel '{}' not found", name));
    }

    let project = state.current_project.lock().await;
    if let Some(ref proj) = *project {
        let path = proj.path.join("math_channels.json");
        save_math_channels(&path, &channels)?;
    }

    Ok(())
}

#[tauri::command]
pub async fn validate_math_expression(expr: String) -> Result<String, String> {
    let mut parser = libretune_core::ini::expression::Parser::new(&expr);
    match parser.parse() {
        Ok(_) => Ok("Valid expression".to_string()),
        Err(e) => Err(e),
    }
}

/// One overlay requested for batch evaluation over recorded rows.
#[derive(serde::Deserialize)]
pub struct MathOverlayRequest {
    pub name: String,
    pub expression: String,
}

/// Evaluate math expressions over many recorded rows at once (graph overlays).
///
/// Parses every expression first — an invalid one aborts the batch with its
/// message. Overlays run in dependency order like the realtime stream
/// (#127), so an overlay may reference raw channels and overlays evaluated
/// before it. Unknown identifiers read 0, exactly like the live stream, so
/// an overlay matches its live trace; rows that fail to evaluate or go
/// non-finite come back null so the trace shows a gap instead of a lie.
#[tauri::command]
pub async fn evaluate_math_series(
    overlays: Vec<MathOverlayRequest>,
    rows: Vec<std::collections::HashMap<String, f64>>,
) -> Result<std::collections::HashMap<String, Vec<Option<f64>>>, String> {
    use libretune_core::ini::expression::{evaluate, Parser};
    use libretune_core::project::{math_channel_evaluation_order, UserMathChannel};

    let mut compiled: Vec<(String, libretune_core::ini::expression::Expr)> =
        Vec::with_capacity(overlays.len());
    for overlay in &overlays {
        let mut parser = Parser::new(&overlay.expression);
        match parser.parse() {
            Ok(ast) => compiled.push((overlay.name.clone(), ast)),
            Err(e) => {
                return Err(format!(
                    "Invalid expression for overlay '{}': {}",
                    overlay.name, e
                ))
            }
        }
    }

    let mut order_helper: Vec<UserMathChannel> = overlays
        .iter()
        .map(|o| UserMathChannel::new(o.name.clone(), String::new(), o.expression.clone()))
        .collect();
    let order = math_channel_evaluation_order(&mut order_helper);

    let mut owned_rows = rows;
    let mut out = std::collections::HashMap::with_capacity(compiled.len());
    for i in order {
        let (name, ast) = &compiled[i];
        let mut series = Vec::with_capacity(owned_rows.len());
        for row in owned_rows.iter_mut() {
            let value = evaluate(ast, row, None)
                .ok()
                .map(|v| v.as_f64())
                .filter(|v| v.is_finite());
            if let Some(v) = value {
                row.insert(name.clone(), v);
            }
            series.push(value);
        }
        out.insert(name.clone(), series);
    }
    Ok(out)
}

#[cfg(test)]
mod evaluate_math_series_tests {
    use super::*;

    fn rows() -> Vec<std::collections::HashMap<String, f64>> {
        vec![
            [("rpm".to_string(), 1000.0), ("afr".to_string(), 14.0)]
                .into_iter()
                .collect(),
            [("rpm".to_string(), 2000.0), ("afr".to_string(), 15.0)]
                .into_iter()
                .collect(),
        ]
    }

    fn req(name: &str, expression: &str) -> MathOverlayRequest {
        MathOverlayRequest {
            name: name.to_string(),
            expression: expression.to_string(),
        }
    }

    fn approx(series: &[Option<f64>], expected: &[f64]) {
        assert_eq!(series.len(), expected.len());
        for (got, want) in series.iter().zip(expected) {
            let got = got.expect("row has a value");
            assert!((got - want).abs() < 1e-9, "{got} ≈ {want}");
        }
    }

    #[tokio::test]
    async fn evaluates_per_row() {
        let out = evaluate_math_series(vec![req("err", "afr - 14.7")], rows())
            .await
            .expect("evaluates");
        approx(&out["err"], &[-0.7, 0.3]);
    }

    #[tokio::test]
    async fn unknown_identifiers_read_zero_like_the_live_stream() {
        let out = evaluate_math_series(vec![req("x", "nope * 2")], rows())
            .await
            .expect("evaluates");
        approx(&out["x"], &[0.0, 0.0]);
    }

    #[tokio::test]
    async fn failed_rows_are_gaps() {
        let out = evaluate_math_series(vec![req("x", "nosuchfn(rpm)")], rows())
            .await
            .expect("evaluates");
        assert_eq!(out["x"], vec![None, None]);
    }

    #[tokio::test]
    async fn chained_overlays_see_each_other() {
        let out = evaluate_math_series(
            vec![req("b", "a * 2"), req("a", "rpm / 1000")],
            rows(),
        )
        .await
        .expect("evaluates");
        approx(&out["a"], &[1.0, 2.0]);
        approx(&out["b"], &[2.0, 4.0]);
    }

    #[tokio::test]
    async fn invalid_expression_aborts_the_batch() {
        let err = evaluate_math_series(vec![req("bad", "rpm +")], rows())
            .await
            .expect_err("fails");
        assert!(err.contains("bad"), "names the overlay: {err}");
    }
}
