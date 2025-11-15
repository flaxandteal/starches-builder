use napi_derive::napi;
use std::fs::File;
use std::io::{BufReader, BufWriter};
use flatgeobuf::*;

#[napi]
/// Re-index a FlatGeobuf file by adding a spatial index
///
/// # Arguments
/// * `input_path` - Path to the input FlatGeobuf file (without spatial index)
/// * `output_path` - Path to write the output FlatGeobuf file (with spatial index)
/// * `name` - Name for the FlatGeobuf dataset
/// * `description` - Optional description for the dataset
pub fn reindex_fgb(
  input_path: String,
  output_path: String,
  name: String,
  description: Option<String>,
) -> napi::Result<()> {
  reindex_fgb_impl(&input_path, &output_path, &name, description)
    .map_err(|e| napi::Error::from_reason(format!("FlatGeobuf reindex failed: {}", e)))
}

fn reindex_fgb_impl(
  input_path: &str,
  output_path: &str,
  name: &str,
  description: Option<String>,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
  // Open input file
  let input_file = File::open(input_path)
    .map_err(|e| format!("Failed to open input file {}: {}", input_path, e))?;

  let mut reader_buf = BufReader::new(input_file);
  let reader = FgbReader::open(&mut reader_buf)
    .map_err(|e| format!("Failed to open FlatGeobuf reader: {}", e))?;

  let header = reader.header();
  let geometry_type = header.geometry_type();

  // Create writer with spatial index enabled
  let mut fgb = FgbWriter::create_with_options(
    name,
    geometry_type,
    FgbWriterOptions {
      description: description.as_deref(),
      write_index: true,
      crs: FgbCrs {
        code: 4326,
        ..Default::default()
      },
      ..Default::default()
    }
  ).map_err(|e| format!("Failed to create FlatGeobuf writer: {}", e))?;

  // Process all features
  let mut feature_reader = reader.select_all()
    .map_err(|e| format!("Failed to select features: {}", e))?;

  feature_reader.process_features(&mut fgb)
    .map_err(|e| format!("Failed to process features: {}", e))?;

  // Write to output file
  let output_file = File::create(output_path)
    .map_err(|e| format!("Failed to create output file {}: {}", output_path, e))?;

  let mut output_buf = BufWriter::new(output_file);
  fgb.write(&mut output_buf)
    .map_err(|e| format!("Failed to write output: {}", e))?;

  Ok(())
}
