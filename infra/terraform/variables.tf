variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "eu-west-1"  # Ireland — closest to Copenhagen
}

variable "environment" {
  description = "Deployment environment (staging or production)"
  type        = string
  default     = "staging"

  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "Environment must be 'staging' or 'production'."
  }
}

variable "admin_role_arn" {
  description = "IAM role ARN for cluster admin access (used by CI/CD)"
  type        = string
  default     = ""
}

