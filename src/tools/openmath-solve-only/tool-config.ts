export type OpenMathToolConfig = {
  max_review_rounds?: number
  state_filename_mode?: "linux" | "windows"
  artifacts?: {
    format?: "json" | "markdown"
    patch?: {
      max_ops?: number
      allow_unique_substring_replace?: boolean
    }
  }
  solve_only?: {
    max_concurrency?: number
    auto_export?: boolean
    export_dir?: string
  }
  export?: {
    default_dir?: string
    overwrite?: boolean
    allowed_base_dirs?: string[]
    default_prefix?: string
  }
}
