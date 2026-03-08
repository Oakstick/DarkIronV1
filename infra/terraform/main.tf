# DarkIron Infrastructure — Terraform Root Module
#
# Provisions:
# - EKS cluster for running the engine
# - VPC with public/private subnets
# - IAM roles for cluster and node groups
#
# Usage:
#   cd infra/terraform
#   terraform init
#   terraform plan -var="environment=staging"
#   terraform apply -var="environment=staging"

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.25"
    }
  }

  # Remote state — uncomment and configure for team use
  # backend "s3" {
  #   bucket         = "darkiron-terraform-state"
  #   key            = "infra/terraform.tfstate"
  #   region         = "eu-west-1"
  #   encrypt        = true
  #   dynamodb_table = "darkiron-terraform-locks"
  # }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "DarkIron"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

# ─── VPC ────────────────────────────────────────────────
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.0"

  name = "darkiron-${var.environment}"
  cidr = "10.0.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24"]

  enable_nat_gateway   = true
  single_nat_gateway   = var.environment == "staging"
  enable_dns_hostnames = true

  public_subnet_tags = {
    "kubernetes.io/role/elb" = 1
  }

  private_subnet_tags = {
    "kubernetes.io/role/internal-elb" = 1
  }
}

# ─── EKS Cluster ────────────────────────────────────────
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = "darkiron-${var.environment}"
  cluster_version = "1.31"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access = true

  eks_managed_node_groups = {
    default = {
      instance_types = var.environment == "production" ? ["m6i.xlarge"] : ["t3.medium"]
      min_size       = var.environment == "production" ? 2 : 1
      max_size       = var.environment == "production" ? 6 : 3
      desired_size   = var.environment == "production" ? 3 : 1

      labels = {
        workload = "darkiron"
      }
    }

    # GPU nodes for future rendering workloads
    # gpu = {
    #   instance_types = ["g5.xlarge"]
    #   min_size       = 0
    #   max_size       = 2
    #   desired_size   = 0
    #   labels = { workload = "gpu" }
    #   taints = [{ key = "nvidia.com/gpu", value = "true", effect = "NO_SCHEDULE" }]
    # }
  }

  # Allow the CD pipeline to deploy
  access_entries = {
    admin = {
      principal_arn = var.admin_role_arn
      policy_associations = {
        admin = {
          policy_arn = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"
          access_scope = { type = "cluster" }
        }
      }
    }
  }
}

# ─── Kubernetes provider (post-cluster) ────────────────
provider "kubernetes" {
  host                   = module.eks.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks.cluster_certificate_authority_data)

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks.cluster_name]
  }
}

