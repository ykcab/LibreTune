//! Typed value access
//!
//! Provides typed access to ECU constants with scale/translate.

use serde::{Deserialize, Serialize};

/// A typed value from ECU memory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Value {
    /// Scalar numeric value
    Scalar(f64),
    /// 1D array of values
    Array1D(Vec<f64>),
    /// 2D array of values
    Array2D {
        data: Vec<f64>,
        rows: usize,
        cols: usize,
    },
    /// Boolean (single bit)
    Bool(bool),
    /// String value
    String(String),
}

impl Value {
    /// Get as scalar, returning None if not a scalar
    pub fn as_scalar(&self) -> Option<f64> {
        match self {
            Value::Scalar(v) => Some(*v),
            _ => None,
        }
    }

    /// Get as bool, returning None if not a bool
    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Value::Bool(v) => Some(*v),
            _ => None,
        }
    }

    /// Get as 1D array
    pub fn as_array_1d(&self) -> Option<&[f64]> {
        match self {
            Value::Array1D(v) => Some(v),
            _ => None,
        }
    }

    /// Get a value from a 2D array
    pub fn get_2d(&self, row: usize, col: usize) -> Option<f64> {
        match self {
            Value::Array2D {
                data,
                rows: _,
                cols,
            } => {
                let idx = row * cols + col;
                data.get(idx).copied()
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scalar_value() {
        let value = Value::Scalar(14.7);
        assert_eq!(value.as_scalar(), Some(14.7));
        assert_eq!(value.as_bool(), None);
    }

    #[test]
    fn test_2d_access() {
        let value = Value::Array2D {
            data: vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
            rows: 2,
            cols: 3,
        };

        assert_eq!(value.get_2d(0, 0), Some(1.0));
        assert_eq!(value.get_2d(0, 2), Some(3.0));
        assert_eq!(value.get_2d(1, 0), Some(4.0));
        assert_eq!(value.get_2d(1, 2), Some(6.0));
    }
}
