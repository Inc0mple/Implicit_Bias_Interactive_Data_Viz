import pandas as pd
import os
import json
import re # For cleaning filenames

# --- Configuration ---
INPUT_CSV_PATH = 'data/combined_response_data_with_cosine_dist_and_score.csv'
OUTPUT_DIR = 'data/split_by_model'
MODEL_COLUMN = 'model_abbrv'
MODELS_INDEX_FILE = os.path.join(OUTPUT_DIR, 'models.json')

# --- Helper Function for Safe Filenames ---
def sanitize_filename(name):
    """Removes or replaces characters unsafe for filenames."""
    # Remove characters that are definitely problematic
    name = re.sub(r'[\\/*?:"<>|]', "", name)
    # Replace spaces with underscores
    name = name.replace(" ", "_")
    # You might add more rules depending on expected model names
    return name

# --- Main Script Logic ---
def split_csv():
    print(f"Starting script: Splitting '{INPUT_CSV_PATH}' by '{MODEL_COLUMN}'...")

    # 1. Create output directory if it doesn't exist
    try:
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        print(f"Output directory '{OUTPUT_DIR}' ensured.")
    except OSError as e:
        print(f"Error creating directory {OUTPUT_DIR}: {e}")
        return # Stop if directory creation fails

    # 2. Load the large CSV
    try:
        print(f"Loading '{INPUT_CSV_PATH}'...")
        # Consider adding dtype={'some_column': str} if pandas misinterprets types
        df = pd.read_csv(INPUT_CSV_PATH)
        print(f"Successfully loaded {len(df)} rows.")
    except FileNotFoundError:
        print(f"Error: Input file not found at '{INPUT_CSV_PATH}'")
        return
    except Exception as e:
        print(f"Error loading CSV: {e}")
        return

    # 3. Check if the model column exists
    if MODEL_COLUMN not in df.columns:
        print(f"Error: Column '{MODEL_COLUMN}' not found in the CSV.")
        return

    # 4. Find unique model abbreviations
    unique_models = df[MODEL_COLUMN].unique()
    # Filter out potential NaN/None values if necessary
    unique_models = [model for model in unique_models if pd.notna(model)]
    print(f"Found {len(unique_models)} unique models: {unique_models}")

    if not unique_models:
        print("No valid models found to split by.")
        return

    # 5. Split and save data for each model
    model_filenames = {} # Store original model name -> sanitized filename stem
    for model in unique_models:
        print(f"  Processing model: '{model}'...")
        filtered_df = df[df[MODEL_COLUMN] == model].copy() # Use .copy() to avoid SettingWithCopyWarning

        # Create a safe filename stem
        sanitized_model_name = sanitize_filename(str(model))
        output_filename = f"{sanitized_model_name}_data.csv"
        output_path = os.path.join(OUTPUT_DIR, output_filename)
        model_filenames[model] = sanitized_model_name # Store mapping

        try:
            filtered_df.to_csv(output_path, index=False)
            print(f"    Saved {len(filtered_df)} rows to '{output_path}'")
        except Exception as e:
            print(f"    Error saving file for model '{model}': {e}")

    # 6. Save the list of models (original names) and their corresponding filename stems
    models_info = {
        "models": unique_models,
        "filename_stems": model_filenames # Map original name -> safe stem
    }
    try:
        with open(MODELS_INDEX_FILE, 'w') as f:
            json.dump(models_info, f, indent=4)
        print(f"Successfully saved models index to '{MODELS_INDEX_FILE}'")
    except Exception as e:
        print(f"Error saving models index file: {e}")

    print("Script finished.")

if __name__ == "__main__":
    split_csv()